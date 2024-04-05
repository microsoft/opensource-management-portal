//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Job 13: refresh repository data

// This is very similar to the query cache, but using proper Postgres type entities, and
// not being used by the app today at runtime. Possible optimizations include only
// targeting refreshes based on last-cached times. The act of refreshing these entities
// also helps keep the standard GitHub repository cache up to date.

import throat from 'throat';

import job from '../job';
import { Organization, sortByRepositoryDate } from '../business';
import { RepositoryEntity, tryGetRepositoryEntity } from '../business/entities/repository';
import { IProviders, IReposJobResult } from '../interfaces';
import { sleep } from '../lib/utils';

const sleepBetweenReposMs = 110;
const maxParallel = 6;

const shouldUpdateCached = true;

async function refreshRepositories(providers: IProviders): Promise<IReposJobResult> {
  const { config, operations } = providers;
  if (config?.jobs?.refreshWrites !== true) {
    console.log('job is currently disabled to avoid metadata refresh/rewrites');
    return;
  }

  const started = new Date();
  console.log(`Starting at ${started.toISOString()}`);

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
  console.log(`Finished at ${new Date().toISOString()}, started at ${started.toISOString()}`);

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
      const prefix =
        'org ' + `${orgIndex + 1}/${orgsLength}:`.padEnd(6) + ` repo ${i + 1}/${repos.length}: `.padEnd(17);
      if (i % 100 === 0) {
        console.log(`${prefix}(Processing ${organization.name}${i > 0 ? ' continues' : ''})`);
      }
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
        let updatedFields: string[] = null;
        let replace = false;
        if (!repositoryEntity) {
          repositoryEntity = new RepositoryEntity();
          setFields(repositoryEntity, entity, true);
          await repositoryProvider.insert(repositoryEntity);
          console.log(`${prefix}inserted ${organization.name}/${repositoryEntity.name}`);
          continue;
        } else {
          updatedFields = setFields(repositoryEntity, entity, false /* not new */);
          replace = updatedFields?.length > 0;
        }
        if (updatedFields.length === 0 && shouldUpdateCached) {
          replace = true;
          repositoryEntity.cached = new Date();
        }
        if (replace) {
          await repositoryProvider.replace(repositoryEntity);
          updatedFields.length > 0 &&
            console.log(
              `${prefix}Updated ${updatedFields.length} field${updatedFields.length === 1 ? '' : 's'} for ${
                organization.name
              }/${repo.name} [${updatedFields.join(', ')}]`
            );
        }
      } catch (error) {
        console.warn(`${prefix}repo error: ${repo.name} in organization ${organization.name}: ${error}`);
      }

      await sleep(sleepBetweenReposMs);
    }
  } catch (organizationError) {
    console.warn(`error processing ${organization.name}: ${organizationError}`);
  }

  return {};
}

function setFields(repositoryEntity: RepositoryEntity, entity: any, isNew: boolean) {
  const changed: string[] = [];
  if (
    (repositoryEntity.repositoryId || entity.id) &&
    String(repositoryEntity.repositoryId) !== String(entity.id)
  ) {
    repositoryEntity.repositoryId = parseInt(entity.id, 10);
    changed.push('id');
  }
  if ((entity.archived || repositoryEntity.archived) && repositoryEntity.archived !== entity.archived) {
    repositoryEntity.archived = entity.archived;
    changed.push('archived');
  }
  if (entity.created_at) {
    const createdAt = new Date(entity.created_at);
    const currentCreatedAt = repositoryEntity.createdAt ? new Date(repositoryEntity.createdAt) : null;
    if (currentCreatedAt && createdAt && currentCreatedAt.toISOString() !== createdAt.toISOString()) {
      repositoryEntity.pushedAt = createdAt;
      changed.push('created_at');
    } else if (!currentCreatedAt && createdAt) {
      repositoryEntity.createdAt = createdAt;
      changed.push('created_at');
    }
  }
  if (
    (entity.default_branch || repositoryEntity.defaultBranch) &&
    entity.default_branch !== repositoryEntity.defaultBranch
  ) {
    repositoryEntity.defaultBranch = entity.default_branch;
    changed.push('default_branch');
  }
  if (
    (entity.description || repositoryEntity.description) &&
    entity.description !== repositoryEntity.description
  ) {
    repositoryEntity.description = entity.description;
    changed.push('description');
  }
  if ((entity.disabled || repositoryEntity.disabled) && entity.disabled !== repositoryEntity.disabled) {
    repositoryEntity.disabled = entity.disabled;
    changed.push('disabled');
  }
  if ((entity.fork || repositoryEntity.fork) && entity.fork !== repositoryEntity.fork) {
    repositoryEntity.fork = entity.fork;
    changed.push('fork');
  }
  if (
    (entity.forks_count || repositoryEntity.forksCount) &&
    String(entity.forks_count) !== String(repositoryEntity.forksCount)
  ) {
    repositoryEntity.forksCount = parseInt(entity.forks_count, 10);
    changed.push('forks_count');
  }
  if (
    (entity.has_downloads || repositoryEntity.hasDownloads) &&
    entity.has_downloads !== repositoryEntity.hasDownloads
  ) {
    repositoryEntity.hasDownloads = entity.has_downloads;
    changed.push('has_downloads');
  }
  if ((entity.has_issues || repositoryEntity.hasIssues) && entity.has_issues !== repositoryEntity.hasIssues) {
    repositoryEntity.hasIssues = entity.has_issues;
    changed.push('has_issues');
  }
  if ((entity.has_pages || repositoryEntity.hasPages) && entity.has_pages !== repositoryEntity.hasPages) {
    repositoryEntity.hasPages = entity.has_pages;
    changed.push('has_pages');
  }
  if (
    (entity.has_projects || repositoryEntity.hasProjects) &&
    entity.has_projects !== repositoryEntity.hasProjects
  ) {
    repositoryEntity.hasProjects = entity.has_projects;
    changed.push('has_projects');
  }
  if ((entity.has_wiki || repositoryEntity.hasWiki) && entity.has_wiki !== repositoryEntity.hasWiki) {
    repositoryEntity.hasWiki = entity.has_wiki;
    changed.push('has_wiki');
  }
  if ((entity.homepage || repositoryEntity.homepage) && entity.homepage !== repositoryEntity.homepage) {
    repositoryEntity.homepage = entity.homepage;
    changed.push('homepage');
  }
  if ((entity.language || repositoryEntity.language) && entity.language !== repositoryEntity.language) {
    repositoryEntity.language = entity.language;
    changed.push('language');
  }
  if (entity.license?.spdx_id !== repositoryEntity.license) {
    repositoryEntity.license = entity.license?.spdx_id;
    changed.push('license.spdx_id');
  }
  if ((entity.full_name || repositoryEntity.fullName) && entity.full_name !== repositoryEntity.fullName) {
    repositoryEntity.fullName = entity.full_name;
    changed.push('full_name');
  }
  if (
    (entity.organization?.id || repositoryEntity.organizationId) &&
    String(entity.organization?.id) !== String(repositoryEntity.organizationId)
  ) {
    repositoryEntity.organizationId = parseInt(entity.organization?.id, 10);
    changed.push('organization.id');
  }
  if (entity.organization?.login !== repositoryEntity.organizationLogin) {
    repositoryEntity.organizationLogin = entity.organization?.login;
    changed.push('organization.login');
  }
  if ((entity.name || repositoryEntity.name) && entity.name !== repositoryEntity.name) {
    repositoryEntity.name = entity.name;
    changed.push('name');
  }
  if (
    (entity.network_count || repositoryEntity.networkCount) &&
    String(entity.network_count) !== String(repositoryEntity.networkCount)
  ) {
    repositoryEntity.networkCount = parseInt(entity.network_count, 10);
    changed.push('network_count');
  }
  if (
    (entity.open_issues_count || repositoryEntity.openIssuesCount) &&
    String(entity.open_issues_count) !== String(repositoryEntity.openIssuesCount)
  ) {
    repositoryEntity.openIssuesCount = parseInt(entity.open_issues_count, 10);
    changed.push('open_issues_count');
  }
  if (
    (entity.parent?.id || repositoryEntity.parentId) &&
    String(entity.parent?.id) !== String(repositoryEntity.parentId)
  ) {
    repositoryEntity.parentId = parseInt(entity.parent?.id, 10);
    changed.push('parent.id');
  }
  if (
    (entity.parent?.login || repositoryEntity.parentName) &&
    entity.parent?.login !== repositoryEntity.parentName
  ) {
    repositoryEntity.parentName = entity.parent?.login;
    changed.push('parent.login');
  }
  if (
    (entity?.parent?.organization?.id || repositoryEntity.parentOrganizationId) &&
    String(entity?.parent?.organization?.id) !== String(repositoryEntity.parentOrganizationId)
  ) {
    repositoryEntity.parentOrganizationId = parseInt(entity.parent?.organization?.id, 10);
    changed.push('parent.organization.id');
  }
  if (
    (entity?.parent?.organization?.login || repositoryEntity.parentOrganizationName) &&
    entity?.parent?.organization?.login !== repositoryEntity.parentOrganizationName
  ) {
    repositoryEntity.parentOrganizationName = entity.parent?.organization?.login;
    changed.push('parent.organization.login');
  }
  if ((entity.private || repositoryEntity.private) && entity.private !== repositoryEntity.private) {
    repositoryEntity.private = entity.private;
    changed.push('private');
  }
  if (entity.pushed_at) {
    const pushedAt = new Date(entity.pushed_at);
    const currentPushedAt = repositoryEntity.pushedAt ? new Date(repositoryEntity.pushedAt) : null;
    if (currentPushedAt && pushedAt && currentPushedAt.toISOString() !== pushedAt.toISOString()) {
      repositoryEntity.pushedAt = pushedAt;
      changed.push('pushed_at');
    } else if (!currentPushedAt && pushedAt) {
      repositoryEntity.pushedAt = pushedAt;
      changed.push('pushed_at');
    }
  }
  if ((entity.size || repositoryEntity.size) && String(entity.size) !== String(repositoryEntity.size)) {
    repositoryEntity.size = parseInt(entity.size, 10);
    changed.push('size');
  }
  if (
    (entity.stargazers_count || repositoryEntity.stargazersCount) &&
    String(entity.stargazers_count) !== String(repositoryEntity.stargazersCount)
  ) {
    repositoryEntity.stargazersCount = parseInt(entity.stargazers_count, 10);
    changed.push('stargazers_count');
  }
  if (
    (entity.subscribers_count || repositoryEntity.subscribersCount) &&
    String(entity.subscribers_count) !== String(repositoryEntity.subscribersCount)
  ) {
    repositoryEntity.subscribersCount = parseInt(entity.subscribers_count, 10);
    changed.push('subscribers_count');
  }
  if (entity.topics && !repositoryEntity.topics) {
    repositoryEntity.topics = entity.topics;
    changed.push('topics');
  } else if (!entity.topics && repositoryEntity.topics) {
    repositoryEntity.topics = null;
    changed.push('topics');
  } else {
    const storedTopics = [...(repositoryEntity.topics || [])].sort();
    const entityTopics = [...(entity.topics || [])].sort();
    if (storedTopics.join(',') !== entityTopics.join(',')) {
      repositoryEntity.topics = entity.topics;
      changed.push('topics');
    }
  }
  if (entity.updated_at) {
    const updatedAt = new Date(entity.updated_at);
    const currentUpdatedAt = repositoryEntity.updatedAt ? new Date(repositoryEntity.updatedAt) : null;
    if (currentUpdatedAt && updatedAt && currentUpdatedAt.toISOString() !== updatedAt.toISOString()) {
      repositoryEntity.updatedAt = updatedAt;
      changed.push('updated_at');
    } else if (!currentUpdatedAt && updatedAt) {
      repositoryEntity.updatedAt = updatedAt;
      changed.push('updated_at');
    }
  }
  if (
    (entity.visibility || repositoryEntity.visibility) &&
    entity.visibility !== repositoryEntity.visibility
  ) {
    repositoryEntity.visibility = entity.visibility;
    changed.push('visibility');
  }
  if (
    (entity.watchers_count || repositoryEntity.watchersCount) &&
    String(entity.watchers_count) !== String(repositoryEntity.watchersCount)
  ) {
    repositoryEntity.watchersCount = parseInt(entity.watchers_count, 10);
    changed.push('watchers_count');
  }
  if (changed.length > 0 || isNew) {
    repositoryEntity.cached = new Date();
  }
  return changed;
}

job.run(refreshRepositories, {
  timeoutMinutes: 600,
  insightsPrefix: 'JobRefreshRepositories',
});
