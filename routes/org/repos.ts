//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import _ from 'lodash';
import asyncHandler from 'express-async-handler';
import express from 'express';
import moment from 'moment';

const lowercaser = require('../../middleware/lowercaser');
import { ReposAppRequest, IProviders } from '../../transitional';
import { Organization } from '../../business/organization';
import { Repository, GitHubCollaboratorAffiliationQuery } from '../../business/repository';
import { RepositoryMetadataEntity } from '../../entities/repositoryMetadata/repositoryMetadata';
import { TeamPermission } from '../../business/teamPermission';
import { Collaborator } from '../../business/collaborator';
import { OrganizationMember } from '../../business/organizationMember';
import { AddRepositoryPermissionsToRequest } from '../../middleware/github/repoPermissions';

import routeAdministrativeLock from './repoAdministrativeLock';
import NewRepositoryLockdownSystem from '../../features/newRepositoryLockdown';
import { ParseReleaseReviewWorkItemId } from '../../utils';
import { ICorporateLink } from '../../business/corporateLink';
import { getReviewService } from '../../api/client/reviewService';
import { IGraphEntry } from '../../lib/graphProvider';

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

router.use('/:repoName/administrativeLock', routeAdministrativeLock);

router.use('/:repoName/delete', asyncHandler(async function(req: ILocalRequest, res, next) {
  const individualContext = req.individualContext;
  const repository = req.repository;
  const organization = req.organization;
  if (!organization.isNewRepositoryLockdownSystemEnabled) {
    return next(new Error('This endpoint is not available as configured in this app.'));
  }
  const daysAfterCreateToAllowSelfDelete = 21; // could be a config setting if anyone cares
  try {
    const metadata = await repository.getRepositoryMetadata();
    await NewRepositoryLockdownSystem.ValidateUserCanSelfDeleteRepository(repository, metadata, individualContext, daysAfterCreateToAllowSelfDelete);
  } catch (noExistingMetadata) {
    if (noExistingMetadata.status === 404) {
      throw new Error('This repository does not have any metadata available regarding who can setup it up. No further actions available.');
    }
    throw noExistingMetadata;
  }
  return next();
}));

router.get('/:repoName/delete', asyncHandler(async function(req: ILocalRequest, res, next) {
  return req.individualContext.webContext.render({
    title: 'Delete the repo you created',
    view: 'repos/delete',
    state: {
      repo: req.repository,
    },
  })
}));

router.post('/:repoName/delete', asyncHandler(async function(req: ILocalRequest, res, next) {
  const { operations, repositoryMetadataProvider } = req.app.settings.providers as IProviders;
  const { organization, repository } = req;
  const lockdownSystem = new NewRepositoryLockdownSystem({ operations, organization, repository, repositoryMetadataProvider });
  await lockdownSystem.deleteLockedRepository(false /* delete for any reason */, true /* deleted by the original user instead of ops */);
  req.individualContext.webContext.saveUserAlert(`You deleted your repo, ${repository.full_name}.`, 'Repo deleted', 'success');
  return res.redirect(organization.baseUrl);
}));


router.post('/:repoName/renameDefaultBranch', asyncHandler(AddRepositoryPermissionsToRequest), asyncHandler(async function(req: ILocalRequest, res, next) {
  const repoPermissions = req.repoPermissions;
  if (!repoPermissions.allowAdministration) {
    return next(new Error('You do not have administrative permission on this repository'));
  }
  const targetBranchName = req.body.targetBranchName || 'main';
  const repository = req.repository as Repository;
  await repository.getDetails();
  try {
    const output = await repository.renameDefaultBranch(targetBranchName);
    // TODO: notify operations as an FYI
    process.nextTick(() => {
      repository.getDetails({
        backgroundRefresh: false,
        maxAgeSeconds: -60, // force a cache refresh now for any views
      }).then(ok => {
        // no-op
      }).catch(error => {
        console.error(`Background refresh error: ${error}`);
      });
    });
    req.individualContext.webContext.render({
      view: 'repos/repoBranchRenamed',
      title: `Branch renamed to ${targetBranchName} for ${repository.name}`,
      state: {
        output,
        repository,
      },
    });
  } catch (error) {
    return next(error);
  }
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
  const { linkProvider, config, graphProvider } = req.app.settings.providers as IProviders;
  const repoPermissions = req.repoPermissions;
  const referer = req.headers.referer as string;
  const fromReposPage = referer && (referer.endsWith('repos') || referer.endsWith('repos/'));
  const organization = req.organization;
  const repository = req.repository;
  const repositoryMetadataEntity = req.repositoryMetadata;
  const organizationSupportsUpdatesApp = await organization.supportsUpdatesApp();
  let repo = null;
  try {
    repo = decorateRepoForView(await repository.getDetails());
  } catch (repoDetailsError) {
    console.dir(repoDetailsError);
    throw repoDetailsError;
  }
  let releaseReviewObject = null, releaseReviewWorkItemId = null;
  try {
    if (repositoryMetadataEntity && repositoryMetadataEntity.releaseReviewUrl) {
      releaseReviewWorkItemId = ParseReleaseReviewWorkItemId(repositoryMetadataEntity.releaseReviewUrl);
      if (releaseReviewWorkItemId) {
        const reviewService = getReviewService(config);
        releaseReviewObject = await reviewService.getReviewByUri(`wit:${releaseReviewWorkItemId}`);
      }
    }
  }
  catch (releaseQueryError) {
    console.dir(releaseQueryError);
  }
  // const { permissions, collaborators, outsideCollaborators } = await calculateRepoPermissions(organization, repository);
  // const systemTeams = combineAllTeams(organization.specialRepositoryPermissionTeams);
  // const teamBasedPermissions = consolidateTeamPermissions(permissions, systemTeams);
  const title = `${repository.name} - Repository`;
  const details = await repository.organization.getDetails();
  organization.id = details.id;
  const activeUserCorporateId = req.individualContext.corporateIdentity.id;
  let createdUserLink: ICorporateLink = null;
  const createdByThirdPartyId = repositoryMetadataEntity && repositoryMetadataEntity.createdByThirdPartyId ? repositoryMetadataEntity.createdByThirdPartyId : null;
  if (createdByThirdPartyId) {
    try {
      createdUserLink = await linkProvider.getByThirdPartyId(createdByThirdPartyId);
    } catch (linkError) {
      console.dir(linkError);
    }
  }
  const createdByCorporateId = repositoryMetadataEntity && repositoryMetadataEntity.createdByCorporateId ? repositoryMetadataEntity.createdByCorporateId : null;
  if (!createdUserLink && createdByCorporateId) {
    try {
      const results = await linkProvider.queryByCorporateId(createdByCorporateId);
      if (results && results.length === 1) {
        createdUserLink = results[0];
      }
    } catch (linkError) {
      console.dir(linkError);
    }
  }
  const createdByThirdPartyUsername = repositoryMetadataEntity && repositoryMetadataEntity.createdByThirdPartyUsername ? repositoryMetadataEntity.createdByThirdPartyUsername : null;
  if (!createdUserLink && createdByThirdPartyUsername) {
    try {
      createdUserLink = await linkProvider.getByThirdPartyUsername(createdByThirdPartyUsername);
    } catch (linkError) {
      console.dir(linkError);
    }
  }
  let currentManagementChain: IGraphEntry[] = null;
  try {
    if (createdUserLink && createdUserLink.corporateId) {
      currentManagementChain = (await graphProvider.getManagementChain(createdUserLink.corporateId)).reverse();
    }
  } catch (ignoreError) {
    console.dir(ignoreError);
  }
  req.individualContext.webContext.render({
    view: 'repos/repo',
    title,
    state: {
      activeUserCorporateId,
      createdUserLink,
      organization,
      reposSubView: 'default',
      repoPermissions,
      entity: repository.getEntity(),
      currentManagementChain,
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
      releaseReviewObject: sanitizeReviewObject(releaseReviewObject),
      releaseReviewWorkItemId,
      organizationSupportsUpdatesApp,
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

router.get('/:repoName/history', asyncHandler(async function (req: ILocalRequest, res, next) {
  const { auditLogRecordProvider } = req.app.settings.providers as IProviders;
  const referer = req.headers.referer as string;
  const fromReposPage = referer && (referer.endsWith('repos') || referer.endsWith('repos/'));
  const organization = req.organization;
  const repository = req.repository;
  const repositoryMetadataEntity = req.repositoryMetadata;
  await repository.getDetails();
  const history = await auditLogRecordProvider.queryAuditLogForRepositoryOperations(repository.id.toString());
  const title = `${repository.name} - History`;
  req.individualContext.webContext.render({
    view: 'repos/history',
    title,
    state: {
      organization,
      repo: decorateRepoForView(repository),
      reposSubView: 'history',
      repository,
      fromReposPage,
      repositoryMetadataEntity,
      history,
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

function sanitizeReviewObject(review) {
  if (!review) {
    return;
  }
  const clean = {...review};
  if (clean.assignedTo) {
    clean.assignedTo = sanitizeReviewer(clean.assignedTo);
  }
  const reviewerRoles = clean.reviewers ? Object.getOwnPropertyNames(clean.reviewers) : [];
  for (const role of reviewerRoles) {
    clean.reviewers[role] = sanitizeReviewer(clean.reviewers[role]);
  }
  return clean;
}

function sanitizeReviewer(entry) {
  if (entry && entry.displayName) {
    let name = entry.displayName as string;
    const projectNameEnd = name.indexOf(']\\');
    if (projectNameEnd >= 0) {
      name = name.substr(projectNameEnd + 2);
    }
    const idIndex = name.indexOf(' <');
    if (idIndex >= 0) {
      name = name.substr(0, idIndex);
    }
    entry.displayName = name;
  }
  return entry;
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
