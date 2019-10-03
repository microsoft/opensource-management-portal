//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import _ from 'lodash';
import asyncHandler from 'express-async-handler';
import express from 'express';
import moment from 'moment';

const lowercaser = require('../../middleware/lowercaser');
import { ReposAppRequest } from '../../transitional';
import { Organization } from '../../business/organization';
import { Repository, GitHubCollaboratorAffiliationQuery } from '../../business/repository';
import { RepositoryMetadataEntity } from '../../entities/repositoryMetadata/repositoryMetadata';
import { Operations } from '../../business/operations';
import { TeamPermission } from '../../business/teamPermission';
import { Collaborator } from '../../business/collaborator';
import { OrganizationMember } from '../../business/organizationMember';
import { AddRepositoryPermissionsToRequest } from '../../middleware/github/repoPermissions';

const router = express.Router();

interface ILocalRequest extends ReposAppRequest {
  repository?: Repository;
  repositoryMetadata?: RepositoryMetadataEntity;
  repoPermissions?: any;
}

interface IFindRepoCollaboratorsExcludingTeamsResult {
  collaborators: Collaborator[];
  outsideCollaborators: Collaborator[];
}

interface ICalculateRepoPermissionsResult extends IFindRepoCollaboratorsExcludingTeamsResult {
  permissions: TeamPermission[];
}

const teamsFilterType = {
  systemTeamsExcluded: 'systemTeamsExcluded',
  systemTeamsOnly: 'systemTeamsOnly',
};

router.use(function (req: ReposAppRequest, res, next) {
  req.individualContext.webContext.pushBreadcrumb('Repositories');
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


async function calculateRepoPermissions(organization: Organization, repository: Repository): Promise<ICalculateRepoPermissionsResult> {
  const teamPermissions = await repository.getTeamPermissions();
  const owners = await organization.getOwners();
  const { collaborators, outsideCollaborators } = await findRepoCollaboratorsExcludingOwners(repository, owners);
  for (let teamPermission of teamPermissions) {
    try {
    teamPermission.resolveTeamMembers();
    } catch (ignoredError) { /* ignored */ }
  }
  return { permissions: teamPermissions, collaborators, outsideCollaborators };
}

async function findRepoCollaboratorsExcludingOwners(repository: Repository, owners: OrganizationMember[]): Promise<IFindRepoCollaboratorsExcludingTeamsResult> {
  const ownersMap = new Map<number, OrganizationMember>();
  for (let i = 0; i < owners.length; i++) {
    ownersMap.set(owners[i].id, owners[i]);
  }
  const collaborators = await repository.getCollaborators({ affiliation: GitHubCollaboratorAffiliationQuery.Direct });
  const outsideCollaborators = await repository.getCollaborators({ affiliation: GitHubCollaboratorAffiliationQuery.Outside });
  function filterOutOwners(collaborator: Collaborator) {
    const id = collaborator.id;
    return !ownersMap.has(id);
  }
  return { collaborators: _.filter(collaborators, filterOutOwners), outsideCollaborators };
}

router.use('/:repoName', asyncHandler(async function(req: ILocalRequest, res, next) {
  const repoName = req.params.repoName;
  const organization = req.organization;
  const repository = organization.repository(repoName);
  await repository.getDetails();
  req.repository = repository;
  req.repositoryMetadata = await repository.getRepositoryMetadata();
  return next();
}));

router.post('/:repoName', asyncHandler(AddRepositoryPermissionsToRequest), asyncHandler(async function(req: ILocalRequest, res, next) {
  const repoPermissions = req.repoPermissions;
  if (!repoPermissions.allowAdministration) {
    return next(new Error('You do not have administrative permission on this repository'));
  }
  // only supporting the 'take public' operation now
  const takePublic = req.body['make-repo-public'];
  if (!takePublic) {
    return next(new Error('Unsupported operation'));
  }
  const repository = req.repository as Repository;
  await repository.editPublicPrivate({ private: false });
  req.individualContext.webContext.saveUserAlert(`${repository.full_name} is now public.`, 'Repository publish', 'success');
  await repository.getDetails({
    backgroundRefresh: false,
    maxAgeSeconds: -60, // force a refresh now
  });
  return res.redirect(`/${repository.organization.name}/repos/${repository.name}?published`);
}));

router.get('/:repoName', asyncHandler(AddRepositoryPermissionsToRequest), asyncHandler(async function (req: ILocalRequest, res, next) {
  const repoPermissions = req.repoPermissions;
  const referer = req.headers.referer as string;
  const fromReposPage = referer && (referer.endsWith('repos') || referer.endsWith('repos/'));
  const operations = req.app.settings.operations as Operations;
  const organization = req.organization;
  const repository = req.repository;
  const gitHubId = req.individualContext.getGitHubIdentity().id;
  const repositoryMetadataEntity = req.repositoryMetadata;
  const repo = decorateRepoForView(await repository.getDetails());
  // const { permissions, collaborators, outsideCollaborators } = await calculateRepoPermissions(organization, repository);
  // const systemTeams = combineAllTeams(organization.specialRepositoryPermissionTeams);
  // const teamBasedPermissions = consolidateTeamPermissions(permissions, systemTeams);
  const title = `${repository.name} - Repository`;
  const details = await repository.organization.getDetails();
  organization.id = details.id;
  req.individualContext.webContext.render({
    view: 'repos/repo',
    title,
    state: {
      organization,
      reposSubView: 'default',
      repoPermissions,
      repo, // : decorateRepoForView(repository),
      repository,
      // permissions: slicePermissionsForView(filterSystemTeams(teamsFilterType.systemTeamsExcluded, systemTeams, permissions)),
      // systemPermissions: slicePermissionsForView(filterSystemTeams(teamsFilterType.systemTeamsOnly, systemTeams, permissions)),
      // collaborators: sliceCollaboratorsForView(collaborators),
      // collaboratorsArray: collaborators,
      // outsideCollaboratorsSlice: sliceCollaboratorsForView(outsideCollaborators),
      // outsideCollaborators: outsideCollaborators,
      // reposDataAgeInformation: ageInformation ? ageInformation : undefined,
      fromReposPage,
      // teamBasedPermissions,
      repositoryMetadataEntity,
    },
  });
}));

router.get('/:repoName/permissions', asyncHandler(AddRepositoryPermissionsToRequest), asyncHandler(async function (req: ILocalRequest, res, next) {
  const referer = req.headers.referer as string;
  const fromReposPage = referer && (referer.endsWith('repos') || referer.endsWith('repos/'));
  const organization = req.organization;
  const repoPermissions = req.repoPermissions;
  const repository = req.repository;
  const repositoryMetadataEntity = req.repositoryMetadata;
  const uc = req.individualContext.aggregations;
  const aggregate = await uc.getAggregatedOverview();
  await repository.getDetails();
  const { permissions, collaborators, outsideCollaborators } = await calculateRepoPermissions(organization, repository);
  const systemTeams = combineAllTeams(organization.specialRepositoryPermissionTeams);
  const teamBasedPermissions = consolidateTeamPermissions(permissions, systemTeams);
  const title = `${repository.name} - Repository`;
  const details = await repository.organization.getDetails();
  organization.id = details.id;
  req.individualContext.webContext.render({
    view: 'repos/permissions',
    title,
    state: {
      organization,
      repo: decorateRepoForView(repository),
      reposSubView: 'permissions',
      repository,
      permissions: slicePermissionsForView(filterSystemTeams(teamsFilterType.systemTeamsExcluded, systemTeams, permissions)),
      systemPermissions: slicePermissionsForView(filterSystemTeams(teamsFilterType.systemTeamsOnly, systemTeams, permissions)),
      collaborators: sliceCollaboratorsForView(collaborators),
      collaboratorsArray: collaborators,
      outsideCollaboratorsSlice: sliceCollaboratorsForView(outsideCollaborators),
      outsideCollaborators: outsideCollaborators,
      // reposDataAgeInformation: ageInformation ? ageInformation : undefined,
      fromReposPage,
      teamSets: aggregateTeamsToSets(aggregate.teams),
      repoPermissions: repoPermissions,
      teamBasedPermissions,
      repositoryMetadataEntity,
    },
  });
}));

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

// function requireAdministration(req, res, next) {
//   const repoPermissions = req.repoPermissions;
//   if (!repoPermissions) {
//     return next(new Error('Not configured for repo permissions'));
//   }
//   if (repoPermissions.allowAdministration === true) {
//     return next();
//   }
//   return next(new Error('You are not authorized to administer this repository.'));
// }

module.exports = router;
