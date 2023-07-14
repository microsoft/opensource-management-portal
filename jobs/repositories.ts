//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// JOB 13: refresh repository data
// This is very similar to the query cache, but using proper Postgres type entities, and
// not being used by the app today.

// Implementation is initial and not as robust (will refresh everything, even things not touched
// since the last update; limited telemetry.)

import throat from 'throat';

import app from '../app';
import { Organization, sortByRepositoryDate } from '../business';
import { IRepositoryProvider, RepositoryEntity } from '../entities/repository';
import { IProviders, IReposJob, IReposJobResult } from '../interfaces';
import { ErrorHelper } from '../transitional';
import { sleep } from '../utils';

const sleepBetweenReposMs = 125;
const maxParallel = 6;

const shouldUpdateCached = true;

async function refreshRepositories({ providers }: IReposJob): Promise<IReposJobResult> {
  const { config, operations } = providers;
  if (config?.jobs?.refreshWrites !== true) {
    console.log('job is currently disabled to avoid metadata refresh/rewrites');
    return;
  }

  const started = new Date();
  console.log(`Starting at ${started}`);

  const orgs = operations.getOrganizations();
  const throttle = throat(maxParallel);
  await Promise.allSettled(
    orgs.map((organization, index) =>
      throttle(async () => {
        return processOrganization(providers, organization, index, orgs.length);
      })
    )
  );

  // TODO: query all, remove any not processed [recently]
  console.log(`Finished at ${new Date()}, started at ${started}`);

  return {};
}

async function processOrganization(
  providers: IProviders,
  organization: Organization,
  orgIndex: number,
  orgsLength: number
): Promise<unknown> {
  const { repositoryProvider } = providers;
  try {
    let repos = await organization.getRepositories();
    repos = repos.sort(sortByRepositoryDate);
    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      const prefix = `org ${orgIndex}/${orgsLength}: repo ${i}/${repos.length}: `;
      try {
        let repositoryEntity = await tryGetRepositoryEntity(repositoryProvider, repo.id);
        if (await repo.isDeleted()) {
          if (repositoryEntity) {
            await repositoryProvider.delete(repositoryEntity);
            console.log(`${prefix}Deleted repository ${organization.name}/${repo.name}`);
          }
          continue;
        }
        const entity = repo.getEntity();
        let update = false;
        if (!repositoryEntity) {
          repositoryEntity = new RepositoryEntity();
          setFields(repositoryProvider, repositoryEntity, entity);
          await repositoryProvider.insert(repositoryEntity);
          console.log(`${prefix}inserted ${organization.name}/${repositoryEntity.name}`);
          continue;
        } else {
          setFields(repositoryProvider, repositoryEntity, entity);
          // not detecting changes now
          update = true;
        }
        if (!update && shouldUpdateCached) {
          update = true;
          repositoryEntity.cached = new Date();
        }
        if (update) {
          await repositoryProvider.replace(repositoryEntity);
          console.log(`${prefix}Updated all fields for ${organization.name}/${repo.name}`);
        }
      } catch (error) {
        console.warn(`${prefix}repo error: ${repo.name} in organization ${organization.name}`);
      }

      await sleep(sleepBetweenReposMs);
    }
  } catch (organizationError) {
    console.warn(`error processing ${organization.name}: ${organizationError}`);
  }

  return {};
}

function setFields(repositoryProvider: IRepositoryProvider, repositoryEntity: RepositoryEntity, entity: any) {
  repositoryEntity.repositoryId = entity.id;
  repositoryEntity.archived = entity.archived;
  repositoryEntity.cached = new Date();
  if (entity.created_at) {
    repositoryEntity.createdAt = new Date(entity.created_at);
  }
  repositoryEntity.defaultBranch = entity.default_branch;
  repositoryEntity.description = entity.description;
  repositoryEntity.disabled = entity.disabled;
  repositoryEntity.fork = entity.fork;
  repositoryEntity.forksCount = entity.forks_count;
  repositoryEntity.hasDownloads = entity.has_downloads;
  repositoryEntity.hasIssues = entity.has_issues;
  repositoryEntity.hasPages = entity.has_pages;
  repositoryEntity.hasProjects = entity.has_projects;
  repositoryEntity.hasWiki = entity.has_wiki;
  repositoryEntity.homepage = entity.homepage;
  repositoryEntity.language = entity.language;
  repositoryEntity.license = entity.license?.spdx_id;
  repositoryEntity.fullName = entity.full_name;
  repositoryEntity.organizationId = entity.organization?.id;
  repositoryEntity.organizationLogin = entity.organization?.login;
  repositoryEntity.name = entity.name;
  repositoryEntity.networkCount = entity.network_count;
  repositoryEntity.openIssuesCount = entity.open_issues_count;
  repositoryEntity.organizationId = entity.organization?.id;
  repositoryEntity.parentId = entity.parent?.id;
  repositoryEntity.parentName = entity.parent?.login;
  repositoryEntity.parentOrganizationId = entity.parent?.organization?.id;
  repositoryEntity.parentOrganizationName = entity.parent?.organization?.login;
  repositoryEntity.private = entity.private;
  if (entity.pushed_at) {
    repositoryEntity.pushedAt = new Date(entity.pushed_at);
  }
  repositoryEntity.size = entity.size;
  repositoryEntity.stargazersCount = entity.stargazers_count;
  repositoryEntity.subscribersCount = entity.subscribers_count;
  repositoryEntity.topics = entity.topics;
  if (entity.updated_at) {
    repositoryEntity.updatedAt = new Date(entity.updated_at);
  }
  repositoryEntity.visibility = entity.visibility;
  repositoryEntity.watchersCount = entity.watchers_count;
  return repositoryEntity;
}

async function tryGetRepositoryEntity(
  repositoryProvider: IRepositoryProvider,
  repositoryId: number
): Promise<RepositoryEntity> {
  try {
    const repositoryEntity = await repositoryProvider.get(repositoryId);
    return repositoryEntity;
  } catch (error) {
    if (ErrorHelper.IsNotFound(error)) {
      return null;
    }
    throw error;
  }
}

app.runJob(refreshRepositories, {
  timeoutMinutes: 320,
  defaultDebugOutput: 'restapi',
  insightsPrefix: 'JobRefreshRepositories',
});
