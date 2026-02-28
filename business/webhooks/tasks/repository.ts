//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// REPOSITORY created or updated

import { WebhookProcessor } from '../organizationProcessor.js';
import { Organization } from '../../index.js';
import NewRepositoryLockdownSystem from '../../features/newRepositories/newRepositoryLockdown.js';
import {
  AppInsightsTelemetryClient,
  getRepositoryMetadataProvider,
  RepositoryLockdownState,
  type IProviders,
} from '../../../interfaces/index.js';
import { GitHubWebhookRepositoryEventBody } from '../../features/newRepositories/types.js';
import { RepositoryLockdownCreateType } from '../../features/newRepositories/interfaces.js';

export default class RepositoryWebhookProcessor implements WebhookProcessor {
  filter(data: any) {
    const eventType = data.properties.event;
    return eventType === 'repository';
  }

  async run(
    providers: IProviders,
    insights: AppInsightsTelemetryClient,
    organization: Organization,
    data: any
  ): Promise<boolean> {
    const { immutable, operations } = providers;
    const event = data.body as GitHubWebhookRepositoryEventBody;
    const queryCache = operations.providers.queryCache;
    let update = false;
    let addOrUpdateRepositoryQueryCache = false;
    let isNewOrTransferred = false;
    let transferSourceLogin: string = null;
    const action = event.action;
    const organizationId = event.organization.id as number;
    const repositoryId = event?.repository?.id as number;
    const repositoryIdAsString = String(repositoryId);
    const organizationIdAsString = String(organizationId);
    if (!operations.isOrganizationManagedById(organizationId)) {
      console.log(
        `skipping organization ID ${organizationId} which is not directly managed: ${event.organization.login}`
      );
      return true;
    }
    immutable?.saveObjectInBackground(
      `orgs/${event?.organization?.login}/repos/${event?.repository?.name}/webhooks`,
      action || 'unknown',
      data
    );
    immutable?.saveObjectInBackground(
      `org/${event?.organization?.id}/repo/${event?.repository?.id}/webhooks`,
      action || 'unknown',
      data
    );
    if (action === 'created' || action === 'transferred') {
      console.log(
        `repo ${action}: ${event.repository.full_name} ${event.repository.visibility} by ${event.sender.login}`
      );
      addOrUpdateRepositoryQueryCache = true;
      isNewOrTransferred = true;
      update = true;
      if (action === 'transferred') {
        transferSourceLogin =
          event?.changes?.owner?.from?.user?.login || event?.changes?.owner?.from?.organization?.login;
      }
    } else if (action === 'deleted') {
      console.log(
        `repo DELETED: ${event.repository.full_name} ${event.repository.visibility} by ${event.sender.login}`
      );
      update = true;
      try {
        if (
          organizationIdAsString === organization.id.toString() &&
          queryCache &&
          queryCache.supportsOrganizationMembership
        ) {
          // TODO: Verify what happens to forks...
          await queryCache.removeRepository(organizationIdAsString, repositoryIdAsString);
        }
      } catch (queryCacheError) {
        console.dir(queryCacheError);
      }
    } else if (action === 'publicized') {
      console.log('a repo went public!');
      addOrUpdateRepositoryQueryCache = true;
    } else if (action === 'privatized') {
      addOrUpdateRepositoryQueryCache = true;
    } else if (action === 'edited') {
      addOrUpdateRepositoryQueryCache = true;
    } else if (action === 'renamed') {
      addOrUpdateRepositoryQueryCache = true;
    } else if (action === 'archived') {
      addOrUpdateRepositoryQueryCache = true;
    } else if (action === 'unarchived') {
      addOrUpdateRepositoryQueryCache = true;
    } else {
      console.log(`repository event not being intercepted: ${action}`);
    }
    if (addOrUpdateRepositoryQueryCache) {
      try {
        if (
          organizationIdAsString === organization.id.toString() &&
          queryCache &&
          queryCache.supportsOrganizationMembership
        ) {
          // FYI: forked repositories do not cause upstream org hooks to fire, but
          // by protecting against the org ID being the same as the webhook, we make
          // sure to not cause confusion in the query cache
          await queryCache.addOrUpdateRepository(
            organizationIdAsString,
            repositoryIdAsString,
            event.repository
          );
        }
      } catch (queryCacheError) {
        console.dir(queryCacheError);
      }
    }
    if (update) {
      // CONSIDER: When to update the entire org list? operations.getRepos() would be cross-org
      // organization.getRepositories(immediateRefreshOptions, () => {
      //   console.log('refreshed repos list after ADD');
      //   const crossOrgRefreshOptions = {
      //     backgroundRefresh: false,
      //     maxAgeSeconds: 15,
      //   };
      //   operations.getRepos(crossOrgRefreshOptions, () => {
      //     console.log('refreshed cross-org repos list with 15s buffer');
      //   });
      // });
    }
    if (
      isNewOrTransferred && // only transferred or created
      // prettier-ignore
      event.sender.login && // CodeQL [SM01513] this is not a security check and rather basic preventative value check logic
      // prettier-ignore
      event.sender.id // CodeQL [SM01513] this is not a security check and rather basic preventative value check logic
    ) {
      const repository = organization.repository(event.repository.name, event.repository);
      const repositoryMetadataProvider = getRepositoryMetadataProvider(organization.operations);
      if (organization.isNewRepositoryLockdownSystemEnabled()) {
        try {
          const lockdownSystem = new NewRepositoryLockdownSystem({
            insights,
            operations,
            organization,
            repository,
            repositoryMetadataProvider,
          });
          const lockdownOutcome = await lockdownSystem.lockdownIfNecessary(
            action as RepositoryLockdownCreateType,
            event.sender.login,
            event.sender.id,
            transferSourceLogin,
            event
          );
          switch (lockdownOutcome) {
            case RepositoryLockdownState.AdministratorLocked: {
              console.log(
                `${organization.name} uses the new repository lockdown system and the new ${repository.name} repository ${action} by ${event.sender.login} was locked down`
              );
              break;
            }
            case RepositoryLockdownState.Deleted: {
              console.log(
                `${organization.name} uses the new repository lockdown system with FORK DELETES and the new ${repository.name} repository was deleted by ${event.sender.login}`
              );
              break;
            }
            default: {
              console.log(`No specific state message for outcome ${lockdownOutcome}:`);
              console.log(
                `New repository ${repository.name}, ${action} by ${event.sender.login}, even though the organization ${organization.name} supports and has enabled the lockdown system`
              );
            }
          }
        } catch (lockdownSystemError) {
          console.warn('lockdownSystemError:');
          console.dir(lockdownSystemError);
        }
      } else if (operations.isManagedGitHubApplicationLogin(event.sender.login)) {
        // If our own app stack created the repository, we skip metadata.
      } else {
        // If not created by an app managed by this system, create metadata
        // TODO: xxx
      }
    }

    // Immediately delete the ticket
    return true;
  }
}
