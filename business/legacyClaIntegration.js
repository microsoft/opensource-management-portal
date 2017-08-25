//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

const async = require('async');

const ossManagementDb = require('../lib/ossManagementDb');
const wrapError = require('../utils').wrapError;

// ----------------------------------------------------------------------------
// Historical information:
// ----------------------------------------------------------------------------
// This file is a hack on top of a very legacy system. It interfaces
// with a SQL Server and installs some GitHub webhooks. Others should
// not need to use this functionality. Hopefully this all goes away
// in time... this is a separate file to keep the goo away.
// ----------------------------------------------------------------------------

function enable(repository, options, callback) {
  options = options || {};
  if (!options.legalEntity) {
    return callback(new Error('The CLA legal entity is required.'));
  }
  const available = repository.organization.isLegacyClaAutomationAvailable();
  if (available === 'offline') {
    return callback(new Error('CLA automation features are temporarily offline.'));
  } else if (available === false) {
    return callback(new Error('This organization has not enabled CLA automation features.'));
  }
  const pair = repository.organization.getLegacySystemObjects();
  const organizationSettings = pair[0];
  const operations = pair[1];
  const insights = operations.insights;
  const legalEntity = options.legalEntity;
  const claTeams = repository.organization.getLegacyClaTeams(false /* do not throw if not configured */);
  let claTeam = claTeams[legalEntity];
  if (!claTeam) {
    return callback(new Error(`No CLA configuration available for the organization and the ${legalEntity} CLA.`));
  }
  const orgDbID = organizationSettings.ossDatabaseId;
  if (!orgDbID) {
    return callback(new Error('No known OSS database ID!!!'));
  }
  const claEntities = operations.legalEntities;
  if (!claEntities) {
    return callback(new Error('No cla entities configured for the system'));
  }
  let claData = {
    repoName: repository.name,
    organizationName: repository.organization.name,
    organizationId: orgDbID,
    description: repository.description,
    isPrivate: repository.private || true,
    repoGitHubId: repository.id,
    webHookId: null,
    emails: options.emails,
    legalEntity: legalEntity,
    licenseId: claEntities[legalEntity].licenseId,
    createdAt: repository.created_at,
    updatedAt: repository.updated_at || Date.now(),
    sourceUrl: repository.html_url,
    isFork: repository.fork || false
  };
  async.waterfall([
    function getRepoDetails(callback) {
      if (claData.repoGitHubId) { // The data for existing repos should be pre-populated.
        return callback();
      }
      repository.getDetails((getDetailsError, details) => { // Populate repo details for new repos.
        if (getDetailsError) {
          return callback(getDetailsError);
        }
        claData.description = details.description;
        claData.isPrivate = details.private || true;
        claData.repoGitHubId = details.id;
        claData.createdAt = details.created_at;
        claData.updatedAt = details.updated_at;
        claData.sourceUrl = details.html_url;
        claData.isFork = details.fork || false;
        return callback();
      });
    },
    function getClaTeam(callback) {
      const team = repository.organization.team(claTeam.id);
      return callback(null, team);
    },
    function addRepoToClaTeam(team, callback) {
      insights.trackEvent('AddRepoToClaTeam', { repoName: repository.name, claTeamId: claTeam.id });
      repository.setTeamPermission(team.id, 'push', callback);
    },
    function getRepoWebhooks() {
      const callback = Array.prototype.slice.call(arguments).pop();
      repository.getWebhooks(callback);
    },
    function findRepoWebhooksAndDeleteOtherClaWebhooks(webhooks) {
      const callback = Array.prototype.slice.call(arguments).pop();
      if (!webhooks || webhooks.length === 0) {
        return callback();
      }
      return async.eachSeries(webhooks, (webhook, next) => {
        let webhookUrl = null;
        if (webhook && webhook.config) {
          webhookUrl = webhook.config.url;
        }
        if (webhookUrl === claEntities[claData.legalEntity].webhookUrl) {
          // CLA webhook already exists for this CLA entity.
          claData.webHookId = webhook.id;
          return next();
        } else {
          const claKeys = Object.keys(claEntities);
          return async.eachSeries(claKeys, (key, innerNext) => {
            if (claEntities[key].webhookUrl === webhookUrl) {
              // Check if there is another existing CLA webhook.
              insights.trackEvent('DeleteClaWebhook', { repoName: repository.name, claEntity: key, webhookUrl: webhookUrl });
              repository.deleteWebhook(webhook.id, innerNext);
            } else {
              return innerNext();
            }
          }, next);
        }
      }, callback);
    },
    function addClaWebhook() {
      const callback = Array.prototype.slice.call(arguments).pop();
      if (claData.webHookId) { // CLA web hook already exists
        return callback(null);
      }
      insights.trackEvent('AddClaWebhook', { repoName: repository.name, claEntity: claData.legalEntity, webhookUrl: claEntities[claData.legalEntity].webhookUrl });
      const webhookOptions = {
        events: ['pull_request'],
        url: claEntities[claData.legalEntity].webhookUrl,
      };
      repository.createWebhook(webhookOptions, (error, response) => {
        claData.webHookId = response.id;
        return callback(null);
      });
    },
    function upsertClaReposDataInDb() {
      const callback = Array.prototype.slice.call(arguments).pop();
      insights.trackEvent('UpsertClaReposDataInDb', claData);
      const ossDbClient = operations.providers.ossDbConnection;
      ossManagementDb.upsertClaRepositoryData(ossDbClient, claData, callback);
    }
  ], function asyncComplete(error) {
    if (error) {
      insights.trackException(error, { name: 'EnableLegacyClaAutomationError' });
    }
    return callback(error);
  });
}

function has(repository, callback) {
  repository.getWebhooks((error, webhooks) => {
    if (error || !webhooks) {
      return callback(wrapError(error, 'Could not retrieve the web hooks to check for CLA automation.'));
    }
    for (let i = 0; i < webhooks.length; i++) {
      const webhook = webhooks[i];
      if (
          webhook &&
          webhook.config &&
          webhook.config.url &&
          webhook.config.url === 'https://cla.microsoft.com/webhooks/pullrequest' ||
          webhook.config.url === 'https://cla.azure.com/webhooks/pullrequest' ||
          webhook.config.url === 'https://cla2.msopentech.com/webhooks/pullrequest' ||
          webhook.config.url === 'https://cla2.dotnetfoundation.org/webhooks/pullrequest') {

        let legalEntity = 'Unknown or former legal entity';
        if (webhook.config.url === 'https://cla.microsoft.com/webhooks/pullrequest' || webhook.config.url === 'https://cla.azure.com/webhooks/pullrequest') {
          legalEntity = 'Microsoft';
        } else if (webhook.config.url === 'https://cla2.msopentech.com/webhooks/pullrequest') {
          legalEntity = 'Microsoft Open Technologies, Inc.';
        } else if (webhook.config.url === 'https://cla2.dotnetfoundation.org/webhooks/pullrequest') {
          legalEntity = '.NET Foundation';
        }

        return callback(null, true, webhook.config.url, legalEntity, 'https://opensource.microsoft.com/resources');
      }
    }
    return callback(null, false);
  });
}

function isAvailableForOrganization(operations, organization, innerSettings) {
  const claTeams = getOrganizationTeams(operations, organization, innerSettings, false /* do not throw if not configured */);
  if (!claTeams) {
    return false;
  }
  return operations.providers.ossDbConnection ? true : 'offline';
}

function getOrganizationTeams(operations, organization, innerSettings, throwIfMissing) {
  if (throwIfMissing === undefined) {
    throwIfMissing = true;
  }
  let claSettings = innerSettings.cla;
  if (!claSettings) {
    const message = `No CLA configurations defined for the ${organization.name} org.`;
    if (throwIfMissing === true) {
      throw new Error(message);
    } else {
      console.warn(message);
      return null;
    }
  }
  let clas = {};
  for (const key in claSettings) {
    clas[key] = organization.team(claSettings[key]);
  }
  return clas;
}

function getCurrentSettings(operations, repository, callback) {
  const ossDbClient = operations.providers.ossDbConnection;
  if (!ossDbClient) {
    return callback(new Error('The legacy CLA database is not connected, current details for the CLA, if any, cannot be returned'));
  }
  ossManagementDb.getClaRepositorySettings(ossDbClient, repository.id, callback);
}

module.exports = {
  enable: enable,
  has: has,
  isAvailableForOrganization,
  getOrganizationTeams,
  getCurrentSettings,
};
