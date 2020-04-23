//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// NOTE: this file at this time is Microsoft-specific and needs to be updated
// and refactored to be useful by others. There are values stored in
// configuration that can be used instead of the hardcoded values within.

import _ from 'lodash';
import { jsonError } from '../../middleware/jsonError';
import { IProviders } from '../../transitional';
import { ICreateRepositoryResult, Organization } from '../../business/organization';
import { RepositoryMetadataEntity, GitHubRepositoryVisibility, GitHubRepositoryPermission, RepositoryLockdownState } from '../../entities/repositoryMetadata/repositoryMetadata';
import RenderHtmlMail from '../../lib/emailRender';

import { RepoWorkflowEngine, IRepositoryWorkflowOutput } from '../org/repoWorkflowEngine';
import { IMailProvider } from '../../lib/mailProvider';
import { asNumber } from '../../utils';
import { IndividualContext } from '../../user';
import NewRepositoryLockdownSystem from '../../features/newRepositoryLockdown';
import { Operations, ICachedEmployeeInformation } from '../../business/operations';

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

export interface ICreateRepositoryApiResult {
  github: any;
  name: string;
}

export async function CreateRepository(req, bodyOverride: unknown, individualContext?: IndividualContext): Promise<ICreateRepositoryApiResult> {
  if (!req.organization) {
    throw jsonError(new Error('No organization available in the route.'), 400);
  }
  const providers = req.app.settings.providers as IProviders;
  const operations = providers.operations;
  const mailProvider = providers.mailProvider;
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
  const existingRepoId = req.body.existingrepoid;
  let metadata: RepositoryMetadataEntity
  let response: any = null;
  if (existingRepoId && !organization.isNewRepositoryLockdownSystemEnabled()) {
    throw jsonError(new Error(`Repository ID ${existingRepoId} provided for a repository within the ${organization.name} org that is not configured for existing repository classification`), 422);
  }
  if (!existingRepoId) {
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
    response = createResult.response;
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
    metadata = new RepositoryMetadataEntity();
    // Store create metadata
    metadata.created = new Date();
    metadata.createdByThirdPartyUsername = msProperties.onBehalfOf;
    if (individualContext && individualContext.corporateIdentity.id) {
      metadata.createdByCorporateId = individualContext.corporateIdentity.id;
      metadata.createdByCorporateUsername = individualContext.corporateIdentity.username;
      metadata.createdByCorporateDisplayName = individualContext.corporateIdentity.displayName;
    }
    // TODO: we also want to store corporate manager information, eventually
    try {
      const account = await operations.getAccountByUsername(metadata.createdByThirdPartyUsername);
      metadata.createdByThirdPartyId = account.id.toString();
    } catch (noAvailableUsername) {
      req.app.settings.providers.insights.trackEvent({
        name: 'ApiRepoCreateInvalidUsername',
        properties: {
          username: metadata.createdByThirdPartyUsername,
          error: noAvailableUsername.message,
          encodedError: JSON.stringify(noAvailableUsername),
        },
      });
    }
    metadata.repositoryName = response.name;
    metadata.repositoryId = response.id;
    metadata.initialRepositoryDescription = response.description;
    metadata.initialRepositoryVisibility = response.private ? GitHubRepositoryVisibility.Private : GitHubRepositoryVisibility.Public;
    metadata.organizationName = req.organization.name.toLowerCase();
    if (organization.id) {
      metadata.organizationId = organization.id.toString();
    }
  } else {
    // Locked down new repo, this is a classification call
    try {
      metadata = await repositoryMetadataProvider.getRepositoryMetadata(existingRepoId);
    } catch (existingError) {
      if (existingError.status && existingError.status === 404) {
        throw new Error(`The existing repository with id=${existingRepoId} cannot be classified as it was not processed as a new repository`);
      } else {
        throw existingError;
      }
    }
    // Verify that the active user is the same person who created it
    if (!individualContext) {
      throw new Error('Existing repository reclassification requires an authenticated identity');
    }
    NewRepositoryLockdownSystem.ValidateUserCanConfigureRepository(metadata, individualContext);
    // CONSIDER: or a org sudo user or a portal administrator
    const repositoryByName = organization.repository(metadata.repositoryName);
    const response = await repositoryByName.getDetails();
    if (response.id != /* loose */ existingRepoId) {
      throw new Error(`The ID of the repo ${metadata.repositoryName} does not match ${existingRepoId}`);
    }
    metadata.lockdownState = RepositoryLockdownState.Unlocked;
    const repoCreateResponse: ICreateRepositoryApiResult = {
      github: response,
      name: response && response.name ? response.name : undefined,
    };
    req.repoCreateResponse = repoCreateResponse;
  }
  metadata.releaseReviewJustification = msProperties.justification;
  metadata.initialLicense = msProperties.license;
  metadata.releaseReviewType = msProperties.approvalType;
  metadata.releaseReviewUrl = msProperties.approvalUrl;
  metadata.initialTemplate = msProperties.template;
  metadata.projectType = msProperties.projectType;
  metadata.initialCorrelationId = req.correlationId;
  // team permissions
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
  let entityId = existingRepoId || null;
  try {
    if (!entityId) {
      entityId = await repositoryMetadataProvider.createRepositoryMetadata(metadata);
    }
  } catch (insertRequestError) {
    const err = jsonError(new Error(`Rolling back, problems creating repo metadata for ${metadata.repositoryName} and repo ${metadata.repositoryId}`), 500);
    req.insights.trackException({
      exception: insertRequestError,
      properties: {
        event: 'ApiRepoCreateRollbackError',
        message: insertRequestError && insertRequestError.message ? insertRequestError.message : insertRequestError,
      },
    });
    if (!req.organization || !metadata || !metadata.repositoryName) {
      throw insertRequestError; // if GitHub never returned
    }
    const newlyCreatedRepo = (req.organization as Organization).repository(metadata.repositoryName);
    await newlyCreatedRepo.delete();
    throw err;
  }
  if (existingRepoId) {
    try {
      await repositoryMetadataProvider.updateRepositoryMetadata(metadata);
    } catch (updateError) {
      throw updateError;
    }
  }
  // req.approvalRequest['ms.approvalId'] = requestId; // TODO: is this ever used?
  const repoWorkflow = new RepoWorkflowEngine(req.organization as Organization, {
    id: entityId,
    repositoryMetadata: metadata,
    createResponse: response,
    isUnlockingExistingRepository: existingRepoId,
    isFork: response ? response.fork : false,
    isTransfer: metadata && metadata.transferSource ? true : false,
  });
  let output = [];
  try {
    output = await generateAndRunSecondaryTasks(repoWorkflow);
  } catch (rollbackNeededError) {
    console.dir(rollbackNeededError);
  }
  if (!req.repoCreateResponse) {
    req.repoCreateResponse = { tasks: null };
  }
  req.repoCreateResponse.tasks = output;
  if (msProperties.notify && mailProvider) {
    try {
    await sendEmail(req, mailProvider, req.apiKeyRow, req.correlationId, output, repoWorkflow.request, msProperties, existingRepoId);
    } catch (mailSendError) {
      console.dir(mailSendError);
    }
  }
  return req.repoCreateResponse;
}

async function generateAndRunSecondaryTasks(repoWorkflow: RepoWorkflowEngine): Promise<IRepositoryWorkflowOutput[]> {
  const results = await repoWorkflow.executeNewRepositoryChores();
  // NOTE: no longer failing with any errors
  return results;
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

async function sendEmail(req, mailProvider: IMailProvider, apiKeyRow, correlationId: string, repoCreateResults, approvalRequest: RepositoryMetadataEntity, msProperties, existingRepoId: any): Promise<void> {
  const { config, operations } = req.app.settings.providers as IProviders;
  const emails = msProperties.notify.split(',');
  let targetType = repoCreateResults.fork ? 'Fork' : 'Repo';
  if (!repoCreateResults.fork && approvalRequest.transferSource) {
    targetType = 'Transfer';
  }
  let managerInfo: ICachedEmployeeInformation = null;
  if (approvalRequest.createdByCorporateId) {
    try {
      managerInfo = await operations.getCachedEmployeeManagementInformation(approvalRequest.createdByCorporateId);
    } catch (ignoreError) {
      console.dir(ignoreError);
    }
  }
  let headline = `${targetType} ready`;
  const serviceShortName = apiKeyRow && apiKeyRow.service ? apiKeyRow.service : undefined;
  let subject = serviceShortName ? `${approvalRequest.repositoryName} ${targetType.toLowerCase()} created by ${serviceShortName}` : `${approvalRequest.repositoryName} ${targetType.toLowerCase()} created`;
  if (existingRepoId) {
    subject = `${approvalRequest.repositoryName} ${targetType.toLowerCase()} ready`;
  }
  const emailTemplate = 'repoApprovals/autoCreated';
  const displayHostname = req.hostname;
  const approvalScheme = displayHostname === 'localhost' && config.webServer.allowHttp === true ? 'http' : 'https';
  const reposSiteBaseUrl = `${approvalScheme}://${displayHostname}/`;
  const mail = {
    to: emails,
    cc: undefined,
    subject,
    correlationId: correlationId,
    category: ['error', 'repos'],
    content: undefined,
  };
  if (managerInfo && managerInfo.managerMail) {
    mail.cc = managerInfo.managerMail;
  }
  const contentOptions = {
    reason: `You are receiving this e-mail because an API request included the e-mail notification address(es) ${msProperties.notify} during the creation of a repo or you are the manager of the person who created the repo.`,
    headline,
    notification: 'information',
    app: 'Microsoft GitHub',
    correlationId,
    approvalRequest,
    existingRepoId,
    results: repoCreateResults,
    version: config.logging.version,
    managerInfo,
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
  console.log(mail);
  console.dir(mail);
  const additionalMail = {...mail};
  try {
    customData.receipt = await mailProvider.sendMail(mail);
    req.insights.trackEvent({ name: 'ApiRepoCreateMailSuccess', properties: customData });
    req.repoCreateResponse.notified = emails;
    } catch (mailError) {
    customData.eventName = 'ApiRepoCreateMailFailure';
    req.insights.trackException({ exception: mailError, properties: customData });
  }
  // send to operations, too
  delete additionalMail.cc;
  const operationsMails = operations.getExtendedOperationsMailAddresses();
  if (operationsMails && operationsMails.length) {
    additionalMail.to = operationsMails;
    contentOptions.reason = `You are receiving this e-mail as the operations contact address(es) ${operationsMails.join(', ')}. A repo has been created or classified.`;
    try {
      additionalMail.content = await RenderHtmlMail(req.app.settings.runtimeConfig.typescript.appDirectory, emailTemplate, contentOptions);
    } catch (renderError) {
      console.dir(renderError);
      return;
    }
    try {
      await mailProvider.sendMail(additionalMail);
    } catch (ignoredError) {
      console.dir(ignoredError);
      return;
    }
  }
}
