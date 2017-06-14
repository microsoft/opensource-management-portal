//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const _ = require('lodash');
const async = require('async');
const emailRender = require('../../lib/emailRender');
const jsonError = require('./jsonError');

const RepoWorkflowEngine = require('../org/RepoWorkflowEngine.js');

const supportedLicenseExpressions = [
  'mit',
  '(mit and cc-by-4.0)',
  'other',
];

const hardcodedApprovalTypes = [
  'ReleaseReview',
  'SmallLibrariesToolsSamples',
  'Migrate',
  'Exempt',
];

const hardcodedClaEntities = [
  'Microsoft',
  '.NET Foundation',
];

function createRepo(req, res, convergedObject, token, callback, doNotCallbackForSuccess) {
  if (!req.org) {
    return callback(jsonError(new Error('No organization available in the route.'), 400));
  }
  const operations = req.app.settings.operations;
  const dc = req.app.settings.dataclient;
  const mailProvider = req.app.settings.mailProvider;

  const ourFields = [
    'ms.onBehalfOf',
    'ms.license',
    'ms.approval',
    'ms.approval-url',
    'ms.justification',
    'ms.cla-entity',
    'ms.cla-mail',
    'ms.notify',
    'ms.teams',
    'ms.template',
  ];
  const properties = {};
  const parameters = req.body;
  ourFields.forEach((fieldName) => {
    if (parameters[fieldName] !== undefined) {
      properties[fieldName] = parameters[fieldName];
      delete parameters[fieldName];
    }
  });
  const msProperties = {
    onBehalfOf: properties['ms.onBehalfOf'] || req.headers['ms-onbehalfof'],
    justification: properties['ms.justification'] || req.headers['ms-justification'],
    license: properties['ms.license'] || req.headers['ms-license'],
    approvalType: properties['ms.approval'] || req.headers['ms-approval'],
    approvalUrl: properties['ms.approval-url'] || req.headers['ms-approval-url'],
    claMail: properties['ms.cla-mail'] || req.headers['ms-cla-mail'],
    claEntity: properties['ms.cla-entity'] || req.headers['ms-cla-entity'],
    notify: properties['ms.notify'] || req.headers['ms-notify'],
    teams: properties['ms.teams'] || req.headers['ms-teams'],
    template: properties['ms.template'] || req.headers['ms-template'],
  };

  // Validate licenses
  let msLicense = msProperties.license;
  if (!msLicense) {
    return callback(jsonError('Missing Microsoft license information', 422));
  }
  msLicense = msLicense.toLowerCase();

  if (supportedLicenseExpressions.indexOf(msLicense) < 0) {
    return callback(jsonError('The provided license expression is not currently supported', 422));
  }

  // Validate approval types
  const msApprovalType = msProperties.approvalType;
  if (!msApprovalType) {
    return callback(jsonError('Missing Microsoft approval type information', 422));
  }
  if (hardcodedApprovalTypes.indexOf(msApprovalType) < 0) {
    return callback(jsonError('The provided approval type is not supported', 422));
  }

  // Validate specifics of what is in the approval
  switch (msApprovalType) {
  case 'ReleaseReview':
    if (!msProperties.approvalUrl) {
      return callback(jsonError('Approval URL for the release review is required when using the release review approval type', 422));
    }
    break;

  case 'SmallLibrariesToolsSamples':
    break;

  case 'Migrate':
    break;

  case 'Exempt':
    if (!msProperties.justification) {
      return callback(jsonError('Justification is required when using the exempted approval type', 422));
    }
    break;

  default:
    return callback(jsonError('The requested approval type is not currently supported.', 422));
  }

  // Validate CLA entity
  if (msProperties.claEntity && hardcodedClaEntities.indexOf(msProperties.claEntity) < 0) {
    return callback(jsonError('The provided CLA entity name is not supported', 422));
  }

  parameters.org = req.org.name;

  const organization = operations.getOrganization(parameters.org);

  // TODO: POST-1ES DAY REMOVE/FIX UNNEEDED CODE HERE
  delete parameters.confirmedPolicyException;

  operations.github.call(token, 'repos.createForOrg', parameters, (error, result) => {
    if (error) {
      // TODO: insights
      return callback(jsonError(error, error.code || 500));
    }

    // strip an internal "cost" part off our response object
    delete result.cost;

    // from this point on any errors should roll back
    req.repoCreateResponse = {
      github: result,
      name: result && result.name ? result.name : undefined,
    };

    req.approvalRequest = {
      ghu: msProperties.onBehalfOf,
      justification: msProperties.justification,
      requested: ((new Date()).getTime()).toString(),
      active: false,
      license: msProperties.license,
      type: 'repo',
      org: req.org.name.toLowerCase(),
      repoName: result.name,
      repoId: result.id,
      repoDescription: result.description,
      repoUrl: result.homepage,
      repoVisibility: result.private ? 'private' : 'public',
      approvalType: msProperties.approvalType,
      approvalUrl: msProperties.approvalUrl,
      claMail: msProperties.claMail,
      claEntity: msProperties.claEntity,
      template: msProperties.template,

      // API-specific:
      apiVersion: req.apiVersion,
      api: true,
      correlationId: req.correlationId,
    };

    let teamNumber = 0;
    const teamTypes = ['pull', 'push', 'admin'];
    downgradeBroadAccessTeams(organization, msProperties.teams);
    for (let i = 0; msProperties.teams && i < teamTypes.length; i++) {
      const teamType = teamTypes[i];
      const idList = msProperties.teams[teamType];
      if (idList && idList.length) {
        for (let j = 0; j < idList.length; j++) {
          const num = teamNumber++;
          const prefix = 'teamid' + num;
          req.approvalRequest[prefix] = idList[j];
          req.approvalRequest[prefix + 'p'] = teamType;
        }
      }
    }
    req.approvalRequest.teamsCount = teamNumber;
    dc.insertGeneralApprovalRequest('repo', req.approvalRequest, (insertRequestError, requestId) => {
      if (insertRequestError) {
        return rollbackRepoError(req, res, callback, 'There was a problem recording information about the repo request', 500, insertRequestError);
      }
      req.approvalRequest['ms.approvalId'] = requestId;
      const repoWorkflow = new RepoWorkflowEngine(null, req.org, { request: req.approvalRequest });
      repoWorkflow.generateSecondaryTasks(function (err, tasks) {
        async.series(tasks || [], function (taskErr, output) {
          if (taskErr) {
            return rollbackRepoError(req, res, callback, 'There was a problem with secondary tasks associated with the repo request', 500, taskErr);
          }
          if (output) {
            req.repoCreateResponse.tasks = output;
          }
          function done() {
            if (doNotCallbackForSuccess) {
              res.status(201);
              return res.json(req.repoCreateResponse);
            } else {
              return callback(null, req.repoCreateResponse);
            }
          }
          if (msProperties.notify && mailProvider) {
            sendEmail(req, mailProvider, req.apiKeyRow, req.correlationId, output, req.approvalRequest, msProperties, () => {
              done();
            });
          } else {
            done();
          }
        });
      });
    });
  });
}

function downgradeBroadAccessTeams(organization, teams) {
  const broadAccessTeams = new Set(organization.broadAccessTeams);
  if (teams.admin && Array.isArray(teams.admin)) {
    _.remove(teams.admin, teamId => {
      if (broadAccessTeams.has(teamId)) {
        teams.pull.push(teamId);
        return true;
      }
      return false;
    });
  }
  teams.pull = _.uniq(teams.pull); // deduplicate
}

function rollbackRepoError(req, res, next, error, statusCode, errorToLog) {
  const err = jsonError(error, statusCode);
  if (errorToLog) {
    req.insights.trackException(errorToLog, {
      event: 'ApiRepoCreateRollbackError',
      message: error && error.message ? error.message : error,
    });
  }
  if (!req.org || !req.repoCreateResponse || !req.repoCreateResponse.name) {
    return next(err);
  }
  const repo = req.org.repo(req.repoCreateResponse.name);
  repo.delete(() => {
    return next(err);
  });
}

function sendEmail(req, mailProvider, apiKeyRow, correlationId, repoCreateResults, approvalRequest, msProperties, callback) {
  const config = req.app.settings.runtimeConfig;
  const emails = msProperties.notify.split(',');
  const headline = 'Repo ready';
  const serviceShortName = apiKeyRow && apiKeyRow.service ? apiKeyRow.service : undefined;
  const subject = serviceShortName ? `${approvalRequest.repoName} repo created by ${serviceShortName}` : `${approvalRequest.repoName} repo created`;
  const emailTemplate = 'repoApprovals/autoCreated';
  const displayHostname = req.hostname;
  const approvalScheme = displayHostname === 'localhost' && config.webServer.allowHttp === true ? 'http' : 'https';
  const reposSiteBaseUrl = `${approvalScheme}://${displayHostname}/`;
  const mail = {
    to: emails,
    subject: subject,
    reason: `You are receiving this e-mail because an API request included the e-mail notification address(es) ${msProperties.notify} during the creation of a repo.`,
    headline: headline,
    classification: 'information',
    service: 'Microsoft GitHub',
    correlationId: correlationId,
  };
  const contentOptions = {
    correlationId: correlationId,
    approvalRequest: approvalRequest,
    results: repoCreateResults,
    version: config.logging.version,
    reposSiteUrl: reposSiteBaseUrl,
    api: serviceShortName, // when used by the client single-page app, this is not considered an API call
    service: serviceShortName,
    serviceOwner: apiKeyRow ? apiKeyRow.owner : undefined,
    serviceDescription: apiKeyRow ? apiKeyRow.description : undefined,
  };
  emailRender.render(req.app.settings.basedir, emailTemplate, contentOptions, (renderError, mailContent) => {
    if (renderError) {
      req.insights.trackException(renderError, {
        content: contentOptions,
        eventName: 'ApiRepoCreateMailRenderFailure',
      });
      return callback(renderError);
    }
    mail.content = mailContent;
    mailProvider.sendMail(mail, (mailError, mailResult) => {
      const customData = {
        content: contentOptions,
        receipt: mailResult,
      };
      if (mailError) {
        customData.eventName = 'ApiRepoCreateMailFailure';
        req.insights.trackException(mailError, customData);
        return callback(mailError);
      }
      req.insights.trackEvent('ApiRepoCreateMailSuccess', customData);
      req.repoCreateResponse.notified = emails;
      callback();
    });
  });
}

module.exports = createRepo;
