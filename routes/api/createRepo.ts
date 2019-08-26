//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// NOTE: this file at this time is Microsoft-specific and needs to be updated
// and refactored to be useful by others. There are values stored in
// configuration that can be used instead of the hardcoded values within.

import _ from 'lodash';
import async = require('async');
import { jsonError } from '../../middleware/jsonError';
import { Operations } from '../../business/operations';
import { IProviders } from '../../transitional';
import { ICreateRepositoryResult, Organization } from '../../business/organization';
import { RepositoryMetadataEntity, GitHubRepositoryVisibility, GitHubRepositoryPermission } from '../../entities/repositoryMetadata/repositoryMetadata';
import { RenderHtmlMail } from '../../lib/emailRender';

import { RepoWorkflowEngine } from '../org/repoWorkflowEngine';

const supportedLicenseExpressions = [
  'mit',
  '(mit and cc-by-4.0)',
  'cc-by-4.0',
  'other',
];

const hardcodedApprovalTypes = [
  'NewReleaseReview',
  'ExistingReleaseReview',
  'SmallLibrariesToolsSamples',
  'Migrate',
  'Exempt',
];

interface ICreateRepositoryApiResult {
  github: any;
  name: string;
}

export function CreateRepositoryCallback(req, res, bodyOverride: any, token, callback) {
  CreateRepository(req, res, bodyOverride, token).then(result => {
    return callback(null, result);
  }).catch(error => {
    return callback(error);
  });
}

export async function CreateRepository(req, res, bodyOverride: any, token): Promise<ICreateRepositoryApiResult> {
  if (!req.organization) {
    throw jsonError(new Error('No organization available in the route.'), 400);
  }
  const providers = req.app.settings.providers as IProviders;
  const operations = providers.operations;
  const mailProvider = req.app.settings.mailProvider;
  const repositoryMetadataProvider = providers.repositoryMetadataProvider;

  const ourFields = [
    'ms.onBehalfOf',
    'ms.license',
    'ms.approval',
    'ms.approval-url',
    'ms.justification',
    'ms.notify',
    'ms.teams',
    'ms.template',
    'ms.project-type',
  ];
  const properties = {};
  const parameters = bodyOverride || req.body;
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
    notify: properties['ms.notify'] || req.headers['ms-notify'],
    teams: properties['ms.teams'] || req.headers['ms-teams'],
    template: properties['ms.template'] || req.headers['ms-template'],
    projectType: properties['ms.project-type'] || req.headers['ms-project-type'],
  };

  // Validate licenses
  let msLicense = msProperties.license;
  if (!msLicense) {
    throw jsonError(new Error('Missing Microsoft license information'), 422);
  }
  msLicense = msLicense.toLowerCase();

  if (supportedLicenseExpressions.indexOf(msLicense) < 0) {
    throw jsonError(new Error('The provided license expression is not currently supported'), 422);
  }

  // Validate approval types
  const msApprovalType = msProperties.approvalType;
  if (!msApprovalType) {
    throw jsonError(new Error('Missing Microsoft approval type information'), 422);
  }
  if (hardcodedApprovalTypes.indexOf(msApprovalType) < 0) {
    throw jsonError(new Error('The provided approval type is not supported'), 422);
  }

  // Validate specifics of what is in the approval
  switch (msApprovalType) {
  case 'NewReleaseReview':
  case 'ExistingReleaseReview':
    if (!msProperties.approvalUrl) {
      throw jsonError(new Error('Approval URL for the release review is required when using the release review approval type'), 422);
    }
    break;

  case 'SmallLibrariesToolsSamples':
    break;

  case 'Exempt':
    if (!msProperties.justification) {
      throw jsonError(new Error('Justification is required when using the exempted approval type'), 422);
    }
    break;

  default:
    throw jsonError(new Error('The requested approval type is not currently supported.'), 422);
  }

  parameters.org = req.organization.name;

  const organization = operations.getOrganization(parameters.org);
  req.app.settings.providers.insights.trackEvent({
    name: 'ApiRepoTryCreateForOrg',
    properties: {
      parameterName: parameters.name,
      description: parameters.description,
      private: parameters.private,
      org: parameters.org,
    },
  });
  let createResult: ICreateRepositoryResult = null;
  try {
    createResult = await organization.createRepository(parameters.name, parameters);
  } catch (error) {
    req.app.settings.providers.insights.trackEvent({
      name: 'ApiRepoCreateForOrgGitHubFailure',
      properties: {
        parameterName: parameters.name,
        private: parameters.private,
        org: parameters.org,
        parameters: JSON.stringify(parameters),
      },
    });
    if (error && error.innerError) {
      const inner = error.innerError;
      req.insights.trackException({
        exception: inner,
        properties: {
          event: 'ApiRepoCreateGitHubErrorInside',
          message: inner && inner.message ? inner.message : inner,
          code: inner && inner.code ? inner.code : '',
          status: inner && inner.status ? inner.status : '',
          statusCode: inner && inner.statusCode ? inner.statusCode : '',
        },
      });
    }
    req.insights.trackException({
      exception: error,
      properties: {
        event: 'ApiRepoCreateGitHubError',
        message: error && error.message ? error.message : error,
      },
    });
    throw jsonError(error, error.status || 500);
  }
  const { repository, response } = createResult;
  req.app.settings.providers.insights.trackEvent({
    name: 'ApiRepoCreateForOrg',
    properties: {
      parameterName: parameters.name,
      description: parameters.description,
      private: parameters.private,
      org: parameters.org,
      result: JSON.stringify(response),
    },
  });

  // strip an internal "cost" part off our response object
  delete response.cost;

    // from this point on any errors should roll back
  const repoCreateResponse: ICreateRepositoryApiResult = {
    github: response,
    name: response && response.name ? response.name : undefined,
  };
  req.repoCreateResponse = repoCreateResponse;

  // TODO: validate that created on behalf of is real? msProperties.onBehalfOf
  const metadata = new RepositoryMetadataEntity();
  metadata.created = new Date();
  metadata.createdByThirdPartyUsername = msProperties.onBehalfOf;
  // TODO: consider adding the id for the username
  metadata.releaseReviewJustification = msProperties.justification;
  metadata.initialLicense = msProperties.license;
  metadata.organizationName = req.organization.name.toLowerCase();
  // TODO: organizationId
  metadata.repositoryName = response.name;
  metadata.repositoryId = response.id;
  metadata.initialRepositoryDescription = response.description;
  metadata.initialRepositoryVisibility = response.private ? GitHubRepositoryVisibility.Private : GitHubRepositoryVisibility.Public;
  metadata.releaseReviewType = msProperties.approvalType;
  metadata.releaseReviewUrl = msProperties.approvalUrl;
  metadata.initialTemplate = msProperties.template;
  metadata.projectType = msProperties.projectType;
  metadata.initialCorrelationId = req.correlationId;

  const teamTypes = ['pull', 'push', 'admin'];
  const typeValues = [GitHubRepositoryPermission.Pull, GitHubRepositoryPermission.Push, GitHubRepositoryPermission.Admin];
  downgradeBroadAccessTeams(organization, msProperties.teams || {});
  for (let i = 0; msProperties.teams && i < teamTypes.length; i++) {
    const teamType = teamTypes[i];
    const enumValue = typeValues[i];
    const idList = msProperties.teams[teamType];
    if (idList && idList.length) {
      for (let j = 0; j < idList.length; j++) {
        metadata.initialTeamPermissions.push({
          permission: enumValue,
          teamId: idList[j],
        });
      }
    }
  }

  let entityId = null;
  try {
    entityId = await repositoryMetadataProvider.createRepositoryMetadata(metadata);
  } catch (insertRequestError) {
    const err = jsonError(new Error(`Rolling back, problems creating repo metadata for ${metadata.repositoryName} and repo ${metadata.repositoryId}`), 500);
    req.insights.trackException({
      exception: insertRequestError,
      properties: {
        event: 'ApiRepoCreateRollbackError',
        message: insertRequestError && insertRequestError.message ? insertRequestError.message : insertRequestError,
      },
    });
    if (!req.organization || !repoCreateResponse || !repoCreateResponse.name) {
      throw insertRequestError; // if GitHub never returned
    }
    const newlyCreatedRepo = (req.organization as Organization).repository(repoCreateResponse.name);
    await newlyCreatedRepo.delete();
    throw err;
  }
  // TODO: is this ever used?
  // req.approvalRequest['ms.approvalId'] = requestId;

  const repoWorkflow = new RepoWorkflowEngine(req.organization as Organization, {
    id: entityId,
    repositoryMetadata: metadata,
  });
  let output = [];
  try {
    output = await generateAndRunSecondaryTasks(repoWorkflow);
  } catch (rollbackNeededError) {

  }
  req.repoCreateResponse.tasks = output;

  if (msProperties.notify && mailProvider) {
    try {
    await sendEmail(req, mailProvider, req.apiKeyRow, req.correlationId, output, repoWorkflow.request, msProperties);
    } catch (mailSendError) {
      console.dir(mailSendError);
    }
  }

  return req.repoCreateResponse;
}

function generateAndRunSecondaryTasks(repoWorkflow: RepoWorkflowEngine): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    repoWorkflow.generateSecondaryTasks(function (err, tasks) {
      async.series(tasks || [], function (taskErr, output: string[]) {
        return taskErr ? reject(taskErr) : resolve(output);
      });
    });
  });
}

function downgradeBroadAccessTeams(organization, teams) {
  const broadAccessTeams = new Set(organization.broadAccessTeams);
  if (teams.admin && Array.isArray(teams.admin)) {
    _.remove(teams.admin, teamId => {
      if (broadAccessTeams.has(teamId)) {
        if (!teams.pull) {
          teams.pull = [];
        }
        teams.pull.push(teamId);
        return true;
      }
      return false;
    });
  }
  if (teams.pull && Array.isArray(teams.pull)) {
    teams.pull = _.uniq(teams.pull); // deduplicate
  }
}

async function sendEmail(req, mailProvider, apiKeyRow, correlationId: string, repoCreateResults, approvalRequest: RepositoryMetadataEntity, msProperties): Promise<void> {
  const config = req.app.settings.runtimeConfig;
  const emails = msProperties.notify.split(',');
  const headline = 'Repo ready';
  const serviceShortName = apiKeyRow && apiKeyRow.service ? apiKeyRow.service : undefined;
  const subject = serviceShortName ? `${approvalRequest.repositoryName} repo created by ${serviceShortName}` : `${approvalRequest.repositoryName} repo created`;
  const emailTemplate = 'repoApprovals/autoCreated';
  const displayHostname = req.hostname;
  const approvalScheme = displayHostname === 'localhost' && config.webServer.allowHttp === true ? 'http' : 'https';
  const reposSiteBaseUrl = `${approvalScheme}://${displayHostname}/`;
  const mail = {
    to: emails,
    subject: subject,
    correlationId: correlationId,
    category: ['error', 'repos'],
    content: undefined,
  };
  const contentOptions = {
    reason: `You are receiving this e-mail because an API request included the e-mail notification address(es) ${msProperties.notify} during the creation of a repo.`,
    headline: headline,
    notification: 'information',
    app: 'Microsoft GitHub',
    correlationId: correlationId,
    approvalRequest: approvalRequest,
    results: repoCreateResults,
    version: config.logging.version,
    reposSiteUrl: reposSiteBaseUrl,
    liveReposSiteUrl: config.microsoftOpenSource ? config.microsoftOpenSource.repos : null,
    api: serviceShortName, // when used by the client single-page app, this is not considered an API call
    service: serviceShortName,
    serviceOwner: apiKeyRow ? apiKeyRow.owner : undefined,
    serviceDescription: apiKeyRow ? apiKeyRow.description : undefined,
  };
  try {
    mail.content = await RenderHtmlMail(req.app.settings.runtimeConfig.typescript.appDirectory, emailTemplate, contentOptions);
  } catch (renderError) {
    req.insights.trackException({
      exception: renderError,
      properties: {
        content: contentOptions,
        eventName: 'ApiRepoCreateMailRenderFailure',
      },
    });
    throw renderError;
  }
  const customData = {
    content: contentOptions,
    receipt: null,
    eventName: undefined,
  };
  try {
    customData.receipt = await sendMail(mailProvider, contentOptions, mail);
    req.insights.trackEvent({ name: 'ApiRepoCreateMailSuccess', properties: customData });
    req.repoCreateResponse.notified = emails;
    } catch (mailError) {
    customData.eventName = 'ApiRepoCreateMailFailure';
    req.insights.trackException({ exception: mailError, properties: customData });
    // no longer a fatal error if the mail is not sent
  }
}

function sendMail(mailProvider, contentOptions, mail): Promise<any> {
  return new Promise((resolve, reject) => {
    mailProvider.sendMail(mail, (mailError, mailResult) => {
      return mailError ? reject(mailError) : resolve(mailResult);
    });
  });
}
