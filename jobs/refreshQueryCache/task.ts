//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

'use strict';

import throat = require('throat');

import { IProviders, ICacheOptions, IPagedCacheOptions } from '../../transitional';
import { Operations } from '../../business/operations';
import { Organization, IGetOrganizationMembersOptions, OrganizationMembershipRoleQuery, OrganizationMembershipRole } from '../../business/organization';
import { Team, GitHubTeamRole } from '../../business/team';
import { TeamMember } from '../../business/teamMember';
import { RepositoryCacheProvider, IRepositoryCacheProvider } from '../../entities/repositoryCache/repositoryCacheProvider';
import { RepositoryCacheEntity } from '../../entities/repositoryCache/repositoryCache';
import { Repository, IGetCollaboratorsOptions, GitHubCollaboratorAffiliationQuery, GitHubCollaboratorType } from '../../business/repository';
import { IRepositoryCollaboratorCacheProvider } from '../../entities/repositoryCollaboratorCache/repositoryCollaboratorCacheProvider';
import { Collaborator } from '../../business/collaborator';
import { RepositoryCollaboratorCacheEntity } from '../../entities/repositoryCollaboratorCache/repositoryCollaboratorCache';
import { GitHubRepositoryPermission } from '../../entities/repositoryMetadata/repositoryMetadata';
import { ITeamCacheProvider } from '../../entities/teamCache/teamCacheProvider';
import { TeamCacheEntity } from '../../entities/teamCache/teamCache';
import { ITeamMemberCacheProvider, TeamMemberCacheProvider } from '../../entities/teamMemberCache/teamMemberCacheProvider';
import { TeamMemberCacheEntity } from '../../entities/teamMemberCache/teamMemberCache';
import { IRepositoryTeamCacheProvider } from '../../entities/repositoryTeamCache/repositoryTeamCacheProvider';
import { TeamPermission } from '../../business/teamPermission';
import { RepositoryTeamCacheEntity } from '../../entities/repositoryTeamCache/repositoryTeamCache';
import { IOrganizationMemberCacheProvider } from '../../entities/organizationMemberCache/organizationMemberCacheProvider';
import { OrganizationMember } from '../../business/organizationMember';
import { OrganizationMemberCacheEntity } from '../../entities/organizationMemberCache/organizationMemberCache';
import { sleep } from '../../utils';

const slowRequestCacheOptions: IPagedCacheOptions = {
  maxAgeSeconds: 60, // 1m
  backgroundRefresh: false,
  pageRequestDelay: 900, // almost a second
};

const minuteAgoCache: ICacheOptions = {
  maxAgeSeconds: 60,
  backgroundRefresh: false,
};

const sleepBetweenSteps = 2000;

// TODO: we mark when the slow walk starts for the process, use it to set the max age value when requesting entities (?)
// TODO: make max age seconds accept a function that could make it dynamic and functional

let insights;

module.exports = function run(config) {
  const app = require('../../app');
  config.skipModules = new Set([
    'web',
  ]);

  app.initializeApplication(config, null, error => {
    if (error) {
      throw error;
    }
    // TODO: track elapsed time as a metric
    insights = app.settings.appInsightsClient;
    if (!insights) {
      throw new Error('No app insights client available');
    }
    refresh(config, app).then(done => {
      console.log('done');
      process.exit(0);
    }).catch(error => {
      console.dir(error);
      if (insights) {
        insights.trackException({ exception: error, properties: { name: 'JobRefreshQueryCacheFailure' } });
      }
      process.exit(1);
    });
  });
};

interface IRefreshOrganizationResults {

}

async function refreshOrganization(
  organizationMemberCacheProvider: IOrganizationMemberCacheProvider,
  teamCacheProvider: ITeamCacheProvider,
  teamMemberCacheProvider: ITeamMemberCacheProvider,
  repositoryCacheProvider: IRepositoryCacheProvider,
  repositoryCollaboratorCacheProvider: IRepositoryCollaboratorCacheProvider,
  repositoryTeamCacheProvider: IRepositoryTeamCacheProvider,
  organization: Organization): Promise<IRefreshOrganizationResults> {
  const result: IRefreshOrganizationResults = {

  };

  const organizationDetails = await organization.getDetails();
  const organizationId = organizationDetails.id;
  console.log(`refreshing ${organization.name} (id=${organizationId}) organization members, teams, repos and more...`);

  const organizationAdmins = await organization.getMembers({...slowRequestCacheOptions, role: OrganizationMembershipRoleQuery.Admin });
  await cacheOrganizationMembers(organizationMemberCacheProvider, organizationId, organizationAdmins, OrganizationMembershipRole.Admin);
  await sleep(sleepBetweenSteps);

  const organizationMembers = await organization.getMembers({...slowRequestCacheOptions, role: OrganizationMembershipRoleQuery.Member });
  console.log(`organization ${organization.name} has ${organizationAdmins.length} admins and ${organizationMembers.length} members`);
  await cacheOrganizationMembers(organizationMemberCacheProvider, organizationId, organizationMembers, OrganizationMembershipRole.Member);
  await sleep(sleepBetweenSteps);

  const teams = await organization.getTeams(slowRequestCacheOptions);
  console.log(`organization ${organization.name} has ${teams.length} teams`);
  await sleep(sleepBetweenSteps);

  for (let i = 0; i < teams.length; i++) {
    try {
      const team = teams[i];
      const teamDetailsData = await team.getDetails(minuteAgoCache);
      await cacheTeamDetails(teamCacheProvider, organizationId, team, teamDetailsData);
      const teamMaintainers = await team.getMaintainers(slowRequestCacheOptions);
      const maintainers = new Set<string>(teamMaintainers.map(maintainer => maintainer.id ));
      await cacheTeamMembers(teamMemberCacheProvider, organizationId, team, teamMaintainers, GitHubTeamRole.Maintainer);
      const teamMembers = await team.getMembers(slowRequestCacheOptions);
      const nonMaintainerMembers = teamMembers.filter(member => !maintainers.has(member.id));
      await cacheTeamMembers(teamMemberCacheProvider, organizationId, team, nonMaintainerMembers, GitHubTeamRole.Member);
      console.log(`team ${i}/${teams.length}: ${team.name} from org ${organization.name} has ${teamMaintainers.length} maintainers and ${nonMaintainerMembers.length} members`);
      await sleep(sleepBetweenSteps);
    } catch (teamError) {
      console.dir(teamError);
      await sleep(sleepBetweenSteps);
    }
  }

  const repositories = await organization.getRepositories(slowRequestCacheOptions);
  console.log(`${repositories.length} repositories in ${organization.name}`);

  for (let i = 0; i < repositories.length; i++) {
    try {
      const repository = repositories[i];
      const repoDetailsData = await repository.getDetails(minuteAgoCache);
      await cacheRepositoryData(repositoryCacheProvider, repository, repoDetailsData, organizationId);
      await sleep(sleepBetweenSteps);

      const repoTeamPermissions = await repository.getTeamPermissions(slowRequestCacheOptions);
      await cacheRepositoryTeams(repositoryTeamCacheProvider, repository, repoTeamPermissions, organizationId);
      await sleep(sleepBetweenSteps);

      const outsideOptions: IGetCollaboratorsOptions = {...slowRequestCacheOptions, affiliation: GitHubCollaboratorAffiliationQuery.Outside };
      const outsideRepoCollaborators = await repository.getCollaborators(outsideOptions);
      await cacheRepositoryCollaborators(repositoryCollaboratorCacheProvider, organizationId, repository, outsideRepoCollaborators, GitHubCollaboratorType.Outside);
      await sleep(sleepBetweenSteps);

      const outsideSet = new Set<string>(outsideRepoCollaborators.map(outsider => outsider.id ));
      const directOptions: IGetCollaboratorsOptions = {...slowRequestCacheOptions, affiliation: GitHubCollaboratorAffiliationQuery.Direct };
      const directRepoCollaborators = await repository.getCollaborators(directOptions);
      const insideDirectCollaborators = directRepoCollaborators.filter(collaborator => !outsideSet.has(collaborator.id));
      await cacheRepositoryCollaborators(repositoryCollaboratorCacheProvider, organizationId, repository, insideDirectCollaborators, GitHubCollaboratorType.Direct); // technically 'direct' is just those that are not outside collaborators

      console.log(`repository ${i}/${repositories.length}: ${repository.full_name} repository has ${repoTeamPermissions.length} team permissions entries and ${directRepoCollaborators.length} direct collaborators and ${outsideRepoCollaborators.length} outside collaborators`);
      await sleep(sleepBetweenSteps);
    } catch (refreshRepositoryError) {
      console.dir(refreshRepositoryError);
      await sleep(sleepBetweenSteps);
    }
  }

  return result;
}

async function cacheRepositoryTeams(repositoryTeamCacheProvider: IRepositoryTeamCacheProvider, repository: Repository, repoTeamPermissions: TeamPermission[], organizationId: string): Promise<void> {
  const repositoryId = repository.id;
  for (let teamPermission of repoTeamPermissions) {
    const teamId = teamPermission.team.id;
    const permission = teamPermission.permission; // permissionsObjectToValue(collaborator.permissions);

    let cache: RepositoryTeamCacheEntity = null;
    try {
      cache = await repositoryTeamCacheProvider.getRepositoryTeamCacheByTeamId(organizationId, repositoryId, teamId);
    } catch (error) {
      if (!error.code || error.code !== 404) {
        throw error;
      }
    }
    if (cache) {
      const update = cache.permission !== permission;
      if (update) {
        cache.cacheUpdated = new Date();
        await repositoryTeamCacheProvider.updateRepositoryTeamCache(cache);
      }
    } else {
      cache = new RepositoryTeamCacheEntity();
      cache.uniqueId = RepositoryTeamCacheEntity.GenerateIdentifier(organizationId, repositoryId, teamId);
      cache.organizationId = organizationId;
      cache.repositoryId = repositoryId;
      cache.teamId = teamId;
      cache.permission = permission;
      await repositoryTeamCacheProvider.createRepositoryTeamCache(cache);
    }
    console.log(`Saved repo ${repository.full_name} permission ${permission} to team ${teamPermission.team.id}`);
  }
}

const teamFieldsToCache = [
  'privacy',
  'created_at',
  'updated_at',
  'repos_count',
  'members_count',
];

async function cacheTeamDetails(teamCacheProvider: ITeamCacheProvider, organizationId: string, team: Team, teamDetailsData: any): Promise<void> {
  const clonedDetails = {};
  teamFieldsToCache.forEach(key => clonedDetails[key] = teamDetailsData[key]);

  let teamCache: TeamCacheEntity = null;
  try {
    teamCache = await teamCacheProvider.getTeam(team.id);
  } catch (error) {
    if (!error.code || error.code !== 404) {
      throw error;
    }
  }
  if (teamCache) {
    const update = (!teamCache.teamDetails || !teamCache.teamDetails.updated_at || teamCache.teamDetails.updated_at !== teamDetailsData.updated_at);
    if (update) {
      teamCache.cacheUpdated = new Date();
      teamCache.teamDescription = teamDetailsData.description;
      teamCache.teamName = teamDetailsData.name;
      teamCache.teamSlug = teamDetailsData.slug;
      teamCache.teamDetails = clonedDetails;
      await teamCacheProvider.updateTeamCache(teamCache);
      console.log(`team: updated cache for ${teamCache.teamSlug}`);
    }
  } else {
    teamCache = new TeamCacheEntity();
    teamCache.teamId = team.id;
    teamCache.organizationId = organizationId;
    teamCache.teamDescription = teamDetailsData.description;
    teamCache.teamName = teamDetailsData.name;
    teamCache.teamSlug = teamDetailsData.slug;
    teamCache.teamDetails = clonedDetails;
    await teamCacheProvider.createTeamCache(teamCache);
    console.log(`team: new cache for ${teamCache.teamSlug}`);
  }
}

async function cacheTeamMembers(teamMemberCacheProvider: ITeamMemberCacheProvider, organizationId: string, team: Team, members: TeamMember[], typeOfRole: GitHubTeamRole): Promise<void> {
  const teamId = team.id;

  for (let member of members) {
    const userId = member.id;

    let memberCache: TeamMemberCacheEntity = null;
    try {
      memberCache = await teamMemberCacheProvider.getTeamMemberCacheByUserId(organizationId, teamId, userId);
    } catch (error) {
      if (!error.code || error.code !== 404) {
        throw error;
      }
    }
    if (memberCache) {
      const update = memberCache.teamRole !== typeOfRole || memberCache.avatar !== member.avatar_url || memberCache.login !== member.login;
      if (update) {
        memberCache.cacheUpdated = new Date();
        await teamMemberCacheProvider.updateTeamMemberCache(memberCache);
        console.log(`Updated team member id=${member.id} login=${member.login} with role=${typeOfRole} for team=${teamId}`);
      }
    } else {
      memberCache = new TeamMemberCacheEntity();
      memberCache.uniqueId = TeamMemberCacheEntity.GenerateIdentifier(organizationId, teamId, userId);
      memberCache.organizationId = organizationId;
      memberCache.userId = userId;
      memberCache.teamId = teamId;
      memberCache.teamRole = typeOfRole;
      memberCache.login = member.login;
      memberCache.avatar = member.avatar_url;
      await teamMemberCacheProvider.createTeamMemberCache(memberCache);
      console.log(`Saved team member id=${member.id} login=${member.login} with role=${typeOfRole} for team=${teamId}`);
    }
  }
}

async function cacheOrganizationMembers(organizationMemberCacheProvider: IOrganizationMemberCacheProvider, organizationId: string, members: OrganizationMember[], memberRole: OrganizationMembershipRole): Promise<void> {
  for (let member of members) {
    const userId = member.id;

    let cache: OrganizationMemberCacheEntity = null;
    try {
      cache = await organizationMemberCacheProvider.getOrganizationMemberCacheByUserId(organizationId, userId);
    } catch (error) {
      if (!error.code || error.code !== 404) {
        throw error;
      }
    }
    if (cache) {
      const update = cache.role !== memberRole;
      if (update) {
        cache.role = memberRole;
        cache.cacheUpdated = new Date();
        await organizationMemberCacheProvider.updateOrganizationMemberCache(cache);
        console.log(`Updated organization member login=${member.login} id=${member.id} to role=${memberRole}`);
      }
    } else {
      cache = new OrganizationMemberCacheEntity();
      cache.organizationId = organizationId;
      cache.userId = userId;
      cache.uniqueId = OrganizationMemberCacheEntity.GenerateIdentifier(organizationId, userId);
      cache.role = memberRole;
      await organizationMemberCacheProvider.createOrganizationMemberCache(cache);
      console.log(`Saved organization member login=${member.login} id=${member.id} with role=${memberRole}`);
    }
  }
  console.log();
}

async function cacheRepositoryCollaborators(repositoryCollaboratorCacheProvider: IRepositoryCollaboratorCacheProvider, organizationId: string, repository: Repository, repoCollaborators: Collaborator[], typeOfCollaborator: GitHubCollaboratorType): Promise<void> {
  const repositoryId = repository.id;
  for (let collaborator of repoCollaborators) {
    const userId = collaborator.id;
    const permission = permissionsObjectToValue(collaborator.permissions);

    let collaboratorCache: RepositoryCollaboratorCacheEntity = null;
    try {
      collaboratorCache = await repositoryCollaboratorCacheProvider.getRepositoryCollaboratorCacheByUserId(organizationId, repositoryId, userId);
    } catch (error) {
      if (!error.code || error.code !== 404) {
        throw error;
      }
    }
    if (collaboratorCache) {
      const update = collaboratorCache.avatar !== collaborator.avatar_url || collaboratorCache.collaboratorType !== typeOfCollaborator || collaboratorCache.login !== collaborator.login || collaboratorCache.permission !== permission;
      if (update) {
        collaboratorCache.cacheUpdated = new Date();
        await repositoryCollaboratorCacheProvider.updateRepositoryCollaboratorCache(collaboratorCache);
      }
    } else {
      collaboratorCache = new RepositoryCollaboratorCacheEntity();
      collaboratorCache.repositoryId = repositoryId;
      collaboratorCache.organizationId = organizationId;
      collaboratorCache.userId = userId;
      collaboratorCache.uniqueId = RepositoryCollaboratorCacheEntity.GenerateIdentifier(organizationId, repositoryId, userId);
      collaboratorCache.avatar = collaborator.avatar_url;
      collaboratorCache.collaboratorType = typeOfCollaborator;
      collaboratorCache.login = collaborator.login;
      collaboratorCache.permission = permission;
      await repositoryCollaboratorCacheProvider.createRepositoryCollaboratorCache(collaboratorCache);
    }
    console.log(`Saved collaborator login=${collaborator.login} id=${collaborator.id} with type=${typeOfCollaborator}`);
  }
}

function permissionsObjectToValue(permissions): GitHubRepositoryPermission {
  if (permissions.admin === true) {
    return GitHubRepositoryPermission.Admin;
  } else if (permissions.push === true) {
    return GitHubRepositoryPermission.Push;
  } else if (permissions.pull === true) {
    return GitHubRepositoryPermission.Pull;
  }
  throw new Error(`Unsupported GitHubRepositoryPermission value inside permissions`);
}

const repositoryFieldsToCache = [
  'name',
  'private',
  'description',
  'fork',
  'created_at',
  'updated_at',
  'pushed_at',
  'homepage',
  'size',
  'stargazers_count',
  'watchers_count',
  'language',
  'forks_count',
  'archived',
  'disabled',
  'open_issues_count',
  'license',
  'forks',
  'watchers',
  'network_count',
  'subscribers_count',
];

async function cacheRepositoryData(repositoryCacheProvider: IRepositoryCacheProvider, repository: Repository, repoDetailsData: any, organizationId: string): Promise<void> {
  const clonedDetails = {};
  repositoryFieldsToCache.forEach(key => clonedDetails[key] = repoDetailsData[key]);

  let repositoryCache: RepositoryCacheEntity = null;
  try {
    repositoryCache = await repositoryCacheProvider.getRepository(repository.id);
  } catch (error) {
    if (!error.code || error.code !== 404) {
      throw error;
    }
  }
  if (repositoryCache) {
    const update = (!repositoryCache.repositoryDetails || !repositoryCache.repositoryDetails.updated_at || repositoryCache.repositoryDetails.updated_at !== repoDetailsData.updated_at);
    if (update) {
      repositoryCache.cacheUpdated = new Date();
      repositoryCache.repositoryName = repoDetailsData.name;
      repositoryCache.repositoryDetails = clonedDetails;
      await repositoryCacheProvider.updateRepositoryCache(repositoryCache);
    }
  } else {
    repositoryCache = new RepositoryCacheEntity();
    repositoryCache.repositoryId = repository.id;
    repositoryCache.organizationId = organizationId;
    repositoryCache.repositoryName = repository.name;
    repositoryCache.repositoryDetails = clonedDetails;
    await repositoryCacheProvider.createRepositoryCache(repositoryCache);
  }
}

async function refresh(config, app) : Promise<void> {
  const providers = app.settings.providers as IProviders;
  const operations = providers.operations as Operations;
  const repositoryCacheProvider = providers.repositoryCacheProvider;
  const teamCacheProvider = providers.teamCacheProvider;
  const teamMemberCacheProvider = providers.teamMemberCacheProvider;
  const repositoryCollaboratorCacheProvider = providers.repositoryCollaboratorCacheProvider;
  const repositoryTeamCacheProvider = providers.repositoryTeamCacheProvider;
  const organizationMemberCacheProvider = providers.organizationMemberCacheProvider;

  if (!repositoryCacheProvider) {
    throw new Error('repositoryCacheProvider required');
  }
  if (!repositoryCollaboratorCacheProvider) {
    throw new Error('repositoryCollaboratorCacheProvider required');
  }
  if (!teamCacheProvider) {
    throw new Error('teamCacheProvider required');
  }
  if (!teamMemberCacheProvider) {
    throw new Error('teamMemberCacheProvider required');
  }
  if (!repositoryTeamCacheProvider) {
    throw new Error('repositoryTeamCacheProvider required');
  }
  if (!organizationMemberCacheProvider) {
    throw new Error('organizationMemberCacheProvider required');
  }

  const parallelWorkCount = 1;
  const orgs = Array.from(operations.organizations.values());

  let organizationWorkerCount = 0;
  await Promise.all(orgs.map(throat<void, (org: Organization) => Promise<void>>(async organization => {
    await sleep(sleepBetweenSteps);
    console.log(`organization ${++organizationWorkerCount}/${orgs.length}: refreshing ${organization.name}`);
    await refreshOrganization(organizationMemberCacheProvider, teamCacheProvider, teamMemberCacheProvider, repositoryCacheProvider, repositoryCollaboratorCacheProvider, repositoryTeamCacheProvider, organization);
  }, parallelWorkCount)));

  insights.trackEvent({ name: 'JobRefreshQueryCacheSuccess', properties: { } });
}
