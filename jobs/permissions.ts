//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Job 15: System Team Permissions

import { shuffle } from 'lodash';
import throat from 'throat';

import job from '../job';
import { TeamPermission } from '../business/teamPermission';
import { GitHubRepositoryPermission, IProviders, IReposJobResult } from '../interfaces';
import AutomaticTeamsWebhookProcessor from '../business/webhooks/tasks/automaticTeams';
import { sleep } from '../lib/utils';
import { ErrorHelper } from '../lib/transitional';
import { Organization } from '../business';

// Permissions processing: visit all repos and make sure that any designated read, write, admin
// teams for the organization are present on every repo. This job is designed to be run relatively
// regularly but is not looking to answer "the truth" - it will use the cache of repos and other
// assets to not abuse GitHub and its API exhaustively. Over time repos will converge to having
// the right permissions.
//
// If a repository is "compliance locked", the system teams are not enforced until the lock is removed.

const maxParallelism = 3;
const delayBetweenSeconds = 1;

let updatedPermissions = 0;
let updatedRepos = 0;

const missingTeams = new Set<number>();

job.runBackgroundJob(permissionsRun, {
  insightsPrefix: 'JobPermissions',
});

async function permissionsRun(providers: IProviders): Promise<IReposJobResult> {
  const { config, insights, operations } = providers;
  if (config?.jobs?.refreshWrites !== true) {
    console.log('job is currently disabled to avoid metadata refresh/rewrites');
    return;
  }

  const throttle = throat(maxParallelism);

  const organizations = shuffle(Array.from(operations.organizations.values()));

  await Promise.allSettled(
    organizations.map((organization, index) =>
      throttle(async () => {
        return reviewOrganizationSystemTeams(providers, organization, index, organizations.length);
      })
    )
  );

  console.log(`Updated ${updatedPermissions} permissions across ${organizations.length} organizations`);
  insights?.trackMetric({ name: 'JobSystemTeamsUpdatedPermissions', value: updatedPermissions });

  console.log(`Updated ${updatedRepos} repos across ${organizations.length} organizations`);
  insights?.trackMetric({ name: 'JobSystemTeamsUpdatedRepos', value: updatedRepos });

  return {};
}

async function reviewOrganizationSystemTeams(
  providers: IProviders,
  organization: Organization,
  index: number,
  count: number
) {
  const { insights } = providers;
  const prefix = `${index}/${count}: ${organization.name}: `;

  console.log(`${prefix} Reviewing permissions for all repos in ${organization.name}...`);
  try {
    const repos = await organization.getRepositories();
    console.log(`Repos in the ${organization.name} org: ${repos.length}`);
    const automaticTeams = new AutomaticTeamsWebhookProcessor();
    for (const repo of repos) {
      let thisRepoUpdated = false;
      console.log(`${organization.name}/${repo.name}`);
      sleep(1000 * delayBetweenSeconds);
      const cacheOptions = {
        maxAgeSeconds: 10 * 60 /* 10m */,
        backgroundRefresh: false,
      };
      const { specialTeamIds, specialTeamLevels } = automaticTeams.processOrgSpecialTeams(repo.organization);
      let permissions: TeamPermission[] = null;
      try {
        permissions = await repo.getTeamPermissions(cacheOptions);
      } catch (getError) {
        if (ErrorHelper.IsNotFound(getError)) {
          console.log(`Repo gone: ${repo.organization.name}/${repo.name}`);
        } else {
          console.log(
            `There was a problem getting the permissions for the repo ${repo.name} from ${repo.organization.name}`
          );
          console.dir(getError);
        }
        continue;
      }
      let shouldSkipEnforcement = false;
      const { customizedTeamPermissionsWebhookLogic } = providers;
      if (customizedTeamPermissionsWebhookLogic) {
        shouldSkipEnforcement = await customizedTeamPermissionsWebhookLogic.shouldSkipEnforcement(repo);
      }
      const currentPermissions = new Map<number, GitHubRepositoryPermission>();
      permissions.forEach((entry) => {
        currentPermissions.set(Number(entry.team.id), entry.getAsPermission());
      });
      const teamsToSet = new Set<number>();
      specialTeamIds.forEach((specialTeamId) => {
        if (!currentPermissions.has(specialTeamId)) {
          teamsToSet.add(specialTeamId);
        } else if (
          isAtLeastPermissionLevel(
            currentPermissions.get(specialTeamId),
            specialTeamLevels.get(specialTeamId)
          )
        ) {
          // The team permission is already acceptable
        } else {
          console.log(
            `Permission level for ${specialTeamId} is not good enough, expected ${specialTeamLevels.get(
              specialTeamId
            )} but currently ${currentPermissions.get(specialTeamId)}`
          );
          teamsToSet.add(specialTeamId);
        }
      });
      const setArray = Array.from(teamsToSet.values());
      for (const teamId of setArray) {
        const newPermission = specialTeamLevels.get(teamId);
        if (
          shouldSkipEnforcement &&
          (newPermission as GitHubRepositoryPermission) !== GitHubRepositoryPermission.Pull
        ) {
          console.log(
            `should add ${teamId} team with permission ${newPermission} to the repo ${repo.name}, but compliance lock prevents non-read system teams`
          );
          insights?.trackEvent({
            name: 'JobSystemTeamsSkipped',
            properties: {
              org: organization.name,
              repo: repo.name,
              teamId,
              reason: 'compliance lock',
              newPermission,
            },
          });
        } else {
          try {
            if (!missingTeams.has(teamId)) {
              await repo.setTeamPermission(teamId, newPermission as GitHubRepositoryPermission);
              ++updatedPermissions;
              thisRepoUpdated = true;
              insights?.trackEvent({
                name: 'JobSystemTeamsUpdated',
                properties: {
                  org: organization.name,
                  repo: repo.name,
                  teamId,
                  newPermission,
                },
              });
            }
          } catch (error) {
            if (ErrorHelper.IsNotFound(error)) {
              missingTeams.add(teamId);
              console.log(
                `the team ID ${teamId} could not be found when setting to repo ${repo.name} in org ${organization.name} and should likely be removed from config...`
              );
            } else {
              console.log(`${repo.name}`);
              console.dir(error);
              throw error;
            }
          }
        }
      }
      if (thisRepoUpdated) {
        ++updatedRepos;
      }
    }
    console.log(`Finished with repos in ${organization.name} organization`);
  } catch (processOrganizationError) {
    console.dir(processOrganizationError);
    console.log(`moving past ${organization.name} processing due to error...`);
  }
}

function isAtLeastPermissionLevel(value, expected) {
  if (value !== 'admin' && value !== 'push' && value !== 'pull') {
    throw new Error(`The permission type ${value} is not understood by isAtLeastPermissionLevel`);
  }
  if (value === expected) {
    return true;
  }
  // Admin always wins
  if (value === 'admin') {
    return true;
  } else if (expected === 'admin') {
    return false;
  }
  if (expected === 'write' && value === expected) {
    return true;
  }
  if (expected === 'read') {
    return true;
  }
  return false;
}
