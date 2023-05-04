//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// REPOSITORY created or updated

import { WebhookProcessor } from '../organizationProcessor';
import { Organization } from '../../business';
import NewRepositoryLockdownSystem from '../../features/newRepositories/newRepositoryLockdown';
import { getRepositoryMetadataProvider, RepositoryLockdownState, type IProviders } from '../../interfaces';

export default class RepositoryWebhookProcessor implements WebhookProcessor {
  filter(data: any) {
    const eventType = data.properties.event;
    return eventType === 'repository';
  }

  async run(providers: IProviders, organization: Organization, data: any): Promise<boolean> {
    const { immutable, operations } = providers;
    const event = data.body;
    const queryCache = operations.providers.queryCache;
    let update = false;
    let addOrUpdateRepositoryQueryCache = false;
    let isNewOrTransferred = false;
    let transferSourceLogin: string = null;
    const action = event.action;
    const organizationId = event.organization.id as number;
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
    if (action === 'created' || action === 'transferred') {
      console.log(
        `repo ${action}: ${event.repository.full_name} ${
          event.repository.private === 'private' ? 'private' : 'public'
        } by ${event.sender.login}`
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
        `repo DELETED: ${event.repository.full_name} ${
          event.repository.private === 'private' ? 'private' : 'public'
        } by ${event.sender.login}`
      );
      update = true;
      const repositoryIdAsString = event.repository.id.toString();
      const organizationIdAsString = event.organization.id.toString();
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
      const repositoryIdAsString = event.repository.id.toString();
      const organizationIdAsString = event.organization.id.toString();
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
      isNewOrTransferred &&
      event.sender.login &&
      event.sender.id &&
      organization.isNewRepositoryLockdownSystemEnabled()
    ) {
      try {
        const repository = organization.repository(event.repository.name, event.repository);
        const repositoryMetadataProvider = getRepositoryMetadataProvider(organization.operations);
        const lockdownSystem = new NewRepositoryLockdownSystem({
          operations,
          organization,
          repository,
          repositoryMetadataProvider,
        });
        const lockdownOutcome = await lockdownSystem.lockdownIfNecessary(
          action,
          event.sender.login,
          event.sender.id,
          transferSourceLogin
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
    }

    // Immediately delete the ticket
    return true;
  }
}
