//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const _ = require('lodash');
const async = require('async');
const express = require('express');
const extensionsRoute = require('./extensions/');
const lowercaser = require('../../middleware/lowercaser');
const moment = require('moment');
const router = express.Router();

const teamsFilterType = {
  systemTeamsExcluded: 'systemTeamsExcluded',
  systemTeamsOnly: 'systemTeamsOnly',
};

router.use(function (req, res, next) {
  req.legacyUserContext.addBreadcrumb(req, 'Repositories');
  req.reposContext = {
    section: 'repos',
    organization: req.organization,
    pivotDirectlyToOtherOrg: '/repos/', // hack
  };
  req.reposPagerMode = 'org';
  next();
});

router.get('/', lowercaser(['sort', 'language', 'type', 'tt']), require('../reposPager'));

function sliceCollaboratorsForView(collaborators) {
  // Slices to the highest permission level for a collaborator
  const collabView = {
    readers: [],
    writers: [],
    administrators: [],
  };
  collaborators.forEach((collab) => {
    const permission = collab.permissions;
    const destination = permission.admin ? collabView.administrators :
      (permission.push ? collabView.writers :
        (permission.pull ? collabView.readers : null));
    if (destination) {
      destination.push(collab);
    }
  });
  return collabView;
}

function slicePermissionsForView(permissions) {
  const perms = {};
  permissions.forEach(permission => {
    const level = permission.permission;
    if (!level) {
      throw new Error('Invalid operation: no permission associated with the permission entity');
    }
    if (!perms[level]) {
      perms[level] = [];
    }
    perms[level].push(permission);
  });
  return perms;
}

function calculateRepoPermissions(organization, repository, callback) {
  repository.getTeamPermissions((getTeamPermissionsError, teamPermissions) => {
    if (getTeamPermissionsError) {
      return callback(getTeamPermissionsError);
    }
    organization.getOwners((getOwnersError, owners) => {
      if (getOwnersError) {
        return callback(getOwnersError);
      }
      findRepoCollaboratorsExcludingTeams(repository, teamPermissions, owners, (getCollaboratorsError, collaborators, outsideCollaborators) => {
        // Get team members
        async.eachLimit(teamPermissions, 2, (tp, next) => {
          const team = tp.team;
          team.getMembers((membersError, members) => {
            if (!membersError) {
              tp.members = members;
            }
            return next();
          });
        }, error => {
          if (error) {
            return callback(error);
          }
          return callback(getCollaboratorsError, teamPermissions, collaborators, outsideCollaborators);
        });
      });
    });
  });
}

function findRepoCollaboratorsExcludingTeams(repository, teamPermissions, owners, callback) {
  const ownersMap = new Map();
  for (let i = 0; i < owners.length; i++) {
    ownersMap.set(owners[i].id, owners[i]);
  }
  const directCollaboratorOptions = {
    affiliation: 'direct',
  };
  repository.getCollaborators(directCollaboratorOptions, (error, collaborators) => {
    if (error) {
      return callback(error);
    }

    const outsideCollaboratorOptions = {
      affiliation: 'outside',
    };
    repository.getCollaborators(outsideCollaboratorOptions, (error, outsideCollaborators) => {
      if (error) {
        return callback(error);
      }
      function filterOutOwners(collaborator) {
        const id = collaborator.id;
        return !ownersMap.has(id);
      }
      callback(null, _.filter(collaborators, filterOutOwners), outsideCollaborators);
    });
  });
}

router.use('/:repoName', (req, res, next) => {
  const repoName = req.params.repoName;
  const organization = req.organization;
  const repository = organization.repository(repoName);
  repository.getDetails(error => {
    if (error) {
      return next(error);
    }
    req.repository = repository;
    return next();
  });
});

router.use('/:repoName', require('../../middleware/github/repoPermissions'));

function npmPublishingExtension(operations, repository, callback) {
  let data = {
    supported: false,
  };
  const result = {
    npm: data,
  };
  const config = operations.config;
  if (!config || !config.npm || !config.npm.publishing || !config.npm.publishing.token) {
    return callback(null, result);
  }
  repository.getContent('package.json', (getContentError) => {
    if (!getContentError) {
      data.supported = true;
    }
    return callback(null, result);
  });
}

function legacyClaExtension(operations, repository, callback) {
  let cla = {
    supported: false,
    enabled: null,
    legalEntity: null,
    mails: null,
    webhookUrl: null,
  };
  const result = {
    cla: cla,
  };
  const organization = repository.organization;
  cla.teams = organization.legalEntityClaTeams;
  const metadata = organization.getRepositoryCreateMetadata();
  if (!metadata.supportsCla) {
    return callback(null, result);
  }
  cla.supported = true;
  repository.hasLegacyClaAutomation((legacyCheckError, enabled, webhookUrl, legalEntity, learnMoreUrl) => {
    if (legacyCheckError) {
      return callback(legacyCheckError);
    }
    cla.enabled = enabled;
    cla.learnMoreUrl = learnMoreUrl;
    if (enabled) {
      cla.legalEntity = legalEntity;
      cla.webhookUrl = webhookUrl;
    }
    repository.getLegacyClaSettings((getError, settings) => {
      if (settings) {
        cla.mails = settings.NotifierEmails;
        if (settings.UpdatedOn) {
          cla.updatedOn = moment.utc(settings.UpdatedOn);
        }
      }
      return callback(null, result);
    });
  });
}

function getRepoExtensions(operations, repository, callback) {
  const extensions = {};
  const extensionTypes = [
    legacyClaExtension,
    npmPublishingExtension,
  ];
  async.eachLimit(extensionTypes, 2, (extension, next) => {
    extension(operations, repository, (error, result) => {
      if (error) {
        return next(error);
      }
      Object.assign(extensions, result);
      return next();
    });
  }, error => {
    return callback(error, extensions);
  });
}

router.get('/:repoName', (req, res, next) => {
  const referer = req.headers.referer;
  const fromReposPage = referer && (referer.endsWith('repos') || referer.endsWith('repos/'));
  const operations = req.app.settings.operations;
  const organization = req.organization;
  const repoPermissions = req.repoPermissions;
  const repository = req.repository;
  const uc = operations.getUserContext(req.legacyUserContext.id.github);
  return uc.getAggregatedOverview((aggregateError, aggregate) => {
    repository.getDetails((error) => {
      if (aggregateError || error) {
        return next(aggregateError || error);
      }
      calculateRepoPermissions(organization, repository, (getPermissionsError, permissions, collaborators, outsideCollaborators) => {
        if (getPermissionsError) {
          return next(getPermissionsError);
        }
        const systemTeams = combineAllTeams(organization.specialRepositoryPermissionTeams);
        const teamBasedPermissions = consolidateTeamPermissions(permissions, systemTeams);
        const title = `${repository.name} - Repository`;
        getRepoExtensions(operations, repository, (extensionError, extensions) => {
          if (extensionError) {
            return next(extensionError);
          }
          repository.organization.getDetails((error, details) => {
            organization.id = details.id;
            req.legacyUserContext.render(req, res, 'repos/repo', title, {
              organization: organization,
              repo: decorateRepoForView(repository),
              permissions: slicePermissionsForView(filterSystemTeams(teamsFilterType.systemTeamsExcluded, systemTeams, permissions)),
              systemPermissions: slicePermissionsForView(filterSystemTeams(teamsFilterType.systemTeamsOnly, systemTeams, permissions)),
              collaborators: sliceCollaboratorsForView(collaborators),
              collaboratorsArray: collaborators,
              outsideCollaboratorsSlice: sliceCollaboratorsForView(outsideCollaborators),
              outsideCollaborators: outsideCollaborators,
              // reposDataAgeInformation: ageInformation ? ageInformation : undefined,
              fromReposPage: fromReposPage,
              teamSets: aggregateTeamsToSets(aggregate.teams),
              repoPermissions: repoPermissions,
              teamBasedPermissions: teamBasedPermissions,
              extensions: extensions,
            });
          });
        });
      });
    });
  });
});

function consolidateTeamPermissions(permissions, systemTeams) {
  const systemTeamsSet = new Set(systemTeams);
  const filtered = {
    // id -> [] array of teams
    admin: new Map(),
    push: new Map(),
    pull: new Map(),
  };
  for (let i = 0; i < permissions.length; i++) {
    const teamPermission = permissions[i];
    const permission = teamPermission.permission;
    const members = teamPermission.members;
    const team = teamPermission.team;
    const isSystemTeam = systemTeamsSet.has(team.id);
    if (members && !isSystemTeam /* skip system teams */) {
      for (let j = 0; j < members.length; j++) {
        const member = members[j];
        const map = filtered[permission];
        if (map) {
          let entry = map.get(member.id);
          if (!entry) {
            entry = {
              user: member,
              teams: [],
            };
            map.set(member.id, entry);
          }
          entry.teams.push(team);
        }
      }
    }
  }
  const expanded = {
    readers: Array.from(filtered.pull.values()),
    writers: Array.from(filtered.push.values()),
    administrators: Array.from(filtered.admin.values()),
  };
  return expanded.readers.length === 0 && expanded.writers.length === 0 && expanded.administrators.length === 0 ? null : expanded;
}

function combineAllTeams(systemTeams) {
  const allTypes = Object.getOwnPropertyNames(systemTeams);
  const set = new Set();
  allTypes.forEach(type => {
    const values = systemTeams[type];
    if (Array.isArray(values)) {
      for (let i = 0; i < values.length; i++) {
        set.add(values[i]);
      }
    }
  });
  return Array.from(set);
}

function filterSystemTeams(filterType, systemTeams, teams) {
  if (filterType !== teamsFilterType.systemTeamsExcluded && filterType !== teamsFilterType.systemTeamsOnly) {
    throw new Error('Invalid, unsupported teamsFilterType value for filterType');
  }
  const systemSet = new Set(systemTeams);
  return _.filter(teams, permission => {
    const team = permission.team;
    const isSystem = systemSet.has(team.id);
    return filterType === teamsFilterType.systemTeamsOnly ? isSystem : !isSystem;
  });
}

function decorateRepoForView(repo) {
  // This should just be a view service of its own at some point
  fromNow(repo, ['created_at', 'updated_at', 'pushed_at']);
  return repo;
}

function fromNow(object, property) {
  if (Array.isArray(property)) {
    property.forEach(prop => {
      fromNow(object, prop);
    });
    return;
  }
  if (!object.moment) {
    object.moment = {};
  }
  let value = object[property];
  if (value) {
    object.moment[property] = moment(value).fromNow();
    return object.moment[property];
  }
}

function aggregateTeamsToSets(teams) {
  const sets = {
    maintained: teamsToSet(teams.maintainer),
    member: teamsToSet(teams.member),
  };
  return sets;
}

function teamsToSet(teams) {
  const set = new Set();
  if (teams) {
    teams.forEach(team => {
      set.add(team.id);
    });
  }
  return set;
}

function requireAdministration(req, res, next) {
  const repoPermissions = req.repoPermissions;
  if (!repoPermissions) {
    return next(new Error('Not configured for repo permissions'));
  }
  if (repoPermissions.allowAdministration === true) {
    return next();
  }
  return next(new Error('You are not authorized to administer this repository.'));
}

router.use('/:repoName/extensions/cla', requireAdministration, (req, res, next) => {
  const operations = req.app.settings.operations;
  const repository = req.repository;

  legacyClaExtension(operations, repository, (getClaError, extensionData) => {
    if (getClaError) {
      return next(getClaError);
    }
    if (!extensionData || !extensionData.cla) {
      return next(new Error('This organization\'s extension data is currently offline or not configured.'));
    }
    const claSettings = extensionData.cla;

    if (!claSettings.supported) {
      return next(new Error('This organization has not enabled CLA automation at this time.'));
    }

    req.legalClaSettings = claSettings;
    return next();
  });
});

router.get('/:repoName/extensions/cla', function (req, res) {
  const repository = req.repository;
  req.legacyUserContext.addBreadcrumb(req, 'CLA');
  const claSettings = req.legalClaSettings;
  req.legacyUserContext.render(req, res, 'repos/legacyCla', `CLA - ${repository.name}`, {
    claSettings: claSettings,
    repository: repository,
    organization: repository.organization,

    //repoLegacyClaUrl: req.teamReposUrl + repo.name + '/legacyCla',
    //mayHaveLegacyCla: mayHaveLegacyCla,
    //claTeams: req.claTeams,
    //claWebHookUrl: claWebHookUrl,
    //repo: repo,
  });
});

router.post('/:repoName/extensions/cla', (req, res, next) => {
  const repository = req.repository;
  const emails = req.body.emails;
  const currentClaSettings = req.legalClaSettings;
  const repoRoot = '/' + repository.organization.name + '/repos/' + repository.name;

  // If legal entity, it is new; otherwise, just updated the e-mail addresses
  let legalEntity = req.body.legalEntity;
  const isUpdate = !legalEntity;
  if (isUpdate) {
    legalEntity = currentClaSettings.legalEntity;
  }
  repository.enableLegacyClaAutomation({
    emails: emails,
    legalEntity: legalEntity,
  }, (error) => {
    if (error) {
      return next(error);
    }
    req.legacyUserContext.saveUserAlert(req, `${legalEntity} CLA ${isUpdate ? 'updated' : 'configured'} and set to contact ${emails}.`, 'Contribution license agreements', 'success');
    res.redirect(repoRoot);
  });
});

router.use('/:repoName/extensions', extensionsRoute);

module.exports = router;
