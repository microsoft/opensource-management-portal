//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const _ = require('lodash');
const apiUserContext = require('../apiUserContext');
const express = require('express');
const jsonError = require('../jsonError');
const OpenSourceUser = require('../../../lib/context');
const router = express.Router();

const createRepo = require('../createRepo');

router.get('/metadata', (req, res, next) => {
  try {
    const metadata = req.organization.getRepositoryCreateMetadata();
    res.json(metadata);
  } catch (error) {
    return next(jsonError(error, 400));
  }
});

router.get('/personalizedTeams', apiUserContext, (req, res, next) => {
  const orgName = req.organization.name.toLowerCase();
  const operations = req.app.settings.providers.operations;
  const id = req.legacyUserContext.id.github;
  const uc = operations.getUserContext(id);
  let maintainedTeams = new Set();
  const broadTeams = new Set(req.organization.broadAccessTeams);
  uc.getTeamMemberships('maintainer').then(mt => {
    mt.forEach(maintainedTeam => {
      maintainedTeams.add(maintainedTeam.id);
    });
    return uc.getTeamMemberships();
  }).then(teams => {
    _.remove(teams, team => {
      return team.organization.login.toLowerCase() !== orgName;
    });
    teams.forEach(team => {
      delete team.organization;
      delete team.slug;
      team.role = maintainedTeams.has(team.id) ? 'maintainer' : 'member';
      if (broadTeams.has(team.id)) {
        team.broad = true;
      }
    });
    return res.json({
      personalizedTeams: teams,
    });
  }).catch(error => {
    return next(jsonError(error, 400));
  });
});

router.get('/teams', apiUserContext, (req, res, next) => {
  // By default, allow a 30-second old list of teams. If the cached
  // view is older, refresh this list in the background for use if
  // they refresh for a better user experience.
  const caching = {
    backgroundRefresh: true,
    maxAgeSeconds: 30,
  };

  // If the user forces a true refresh, force a true walk of all the teams
  // from GitHub. This will be slow the larger the org. Allow a short cache
  // window for the casewhere a  webhook processes the change quickly.
  if (req.query.refresh) {
    caching.backgroundRefresh = false;
    caching.maxAgeSeconds = 10;
  }

  req.organization.getTeams((getTeamsError, teams) => {
    if (getTeamsError) {
      return next(jsonError(getTeamsError), 400);
    }
    const broadTeams = new Set(req.organization.broadAccessTeams);
    teams.forEach(team => {
      delete team.otherFields;
      delete team.organization;
      delete team.slug;
      if (broadTeams.has(team.id)) {
        team.broad = true;
      }
    });
    res.json({
      teams: teams,
    });
  });
});

router.get('/repo/:repo', (req, res) => {
  const repoName = req.params.repo;
  req.organization.repository(repoName).getDetails((error) => {
    res.status(error ? 404 : 204);
    res.send();
    req.app.settings.providers.insights.trackEvent('ApiClientNewRepoValidateAvailability', {
      found: error ? true : false,
      repoName: repoName,
      org: req.organization.name,
    });
  });
});

function discoverUserIdentities(req, res, next) {
  const options = {
    config: req.app.settings.runtimeConfig,
    dataClient: req.app.settings.dataclient,
    redisClient: req.app.settings.dataclient.cleanupInTheFuture.redisClient,
    redisHelper: req.app.settings.redisHelper,
    request: req,
    insights: req.insights,
    ossDbClient: req.app.settings.providers.ossDbConnection,
    githubLibrary: req.app.settings.providers.github,
    operations: req.app.settings.providers.operations,
  };
  new OpenSourceUser(options, function (error, instance) {
    req.legacyUserContext = instance;
    // Try and also learn if we know their e-mail address to send the new repo mail to
    const upn = instance.modernUser().contactEmail();
    const mailAddressProvider = req.app.settings.providers.mailAddressProvider;
    mailAddressProvider.getAddressFromUpn(upn, (resolveError, mailAddress) => {
      if (!resolveError && mailAddress) {
        req.knownRequesterMailAddress = mailAddress;
      }
      return next();
    });
  });
}

router.post('/repo/:repo', discoverUserIdentities, (req, res, next) => {
  const body = req.body;
  const organization = req.organization;
  if (!body) {
    return next(jsonError('No body', 400));
  }

  const config = req.app.settings.runtimeConfig;

  if (req.legacyUserContext && req.legacyUserContext.usernames) {
    body['ms.onBehalfOf'] = req.legacyUserContext.usernames.github;
  }

  // Allow public or private repository visibility, if the configuration
  // permits, but default to private for now until a user interface is
  // built.
  const createMetadata = organization.getRepositoryCreateMetadata();
  const supportedVisibilities = createMetadata.visibilities || ['public'];
  body.private = supportedVisibilities.includes('private');

  // these fields do not need translation: name, description

  const approvalTypesToIds = config.github.approvalTypes.fields.approvalTypesToIds;
  if (!approvalTypesToIds[body.approvalType]) {
    return next(jsonError('The approval type is not supported or approved at this time', 400));
  }
  body.approvalType = approvalTypesToIds[body.approvalType];
  translateValue(body, 'approvalType', 'ms.approval');
  translateValue(body, 'approvalUrl', 'ms.approval-url');
  translateValue(body, 'justification', 'ms.justification');
  translateValue(body, 'legalEntity', 'ms.cla-entity');
  translateValue(body, 'claMails', 'ms.cla-mail');

  // Team permissions
  if (!body.selectedAdminTeams || !body.selectedAdminTeams.length) {
    return next(jsonError('No administration team(s) provided in the request', 400));
  }
  translateTeams(body);

  // Initial repo contents and license
  const templates = _.keyBy(req.organization.getRepositoryCreateMetadata().templates, 'id');
  const template = templates[body.template];
  if (!template) {
    return next(jsonError('There was a configuration problem, the template metadata was not available for this request', 400));
  }
  translateValue(body, 'template', 'ms.template');
  body['ms.license'] = template.spdx || template.name; // Today this is the "template name" or SPDX if available
  translateValue(body, 'gitIgnoreTemplate', 'gitignore_template');

  if (!body['ms.notify']) {
    body['ms.notify'] = req.knownRequesterMailAddress || config.brand.operationsMail || config.brand.supportMail;
  }

  // these fields are currently ignored:   projectType, orgName, confirmPolicyException
  delete body.projectType;
  delete body.orgName;
  delete body.confirmedPolicyException;
  delete body.claEntity;

  const token = req.organization.getRepositoryCreateGitHubToken();
  createRepo(req, res, body, token, (error, success) => {
    if (error) {
      if (!error.json) {
        error = jsonError(error, 400);
      }
      return next(error);
    }

    success.title = 'Congrats';
    success.message = success.github ?
      `Your new repo, ${success.github.name}, has been created and can be found at ${success.github.html_url}.` :
      'Your repo request has been submitted.';

    // url
    if (success.github) {
      success.url = success.github.html_url;
    }

    // rename tasks to messages
    success.messages = success.tasks;
    delete success.tasks;

    res.json(success);
  }, false /* false means please callback to us with success */);
});

function translateTeams(body) {
  let admin = body.selectedAdminTeams;
  let write = body.selectedWriteTeams;
  let read = body.selectedReadTeams;

  // Remove teams with higher privileges already
  _.pullAll(write, admin);
  _.pullAll(read, admin);
  _.pullAll(read, write);

  body['ms.teams'] = {
    admin: admin,
    push: write,
    pull: read,
  };

  delete body.selectedAdminTeams;
  delete body.selectedWriteTeams;
  delete body.selectedReadTeams;
}

function translateValue(object, fromKey, toKey) {
  if (object[fromKey]) {
    object[toKey] = object[fromKey];
  }
  if (object[fromKey] !== undefined) {
    delete object[fromKey];
  }
}

module.exports = router;
