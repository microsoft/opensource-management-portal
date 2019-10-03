//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["dir", "log"] }] */

'use strict';

import { WebhookProcessor } from "../organizationProcessor";
import { Operations } from "../../business/operations";
import { Organization } from "../../business/organization";

export default class RepositoryWebhookProcessor implements WebhookProcessor {
  filter(data: any) {
    let eventType = data.properties.event;
    return eventType === 'repository';
  }

  async run(operations: Operations, organization: Organization, data: any): Promise<boolean> {
    const event = data.body;
    const queryCache = operations.providers.queryCache;
    const immediateRefreshOptions = {
      backgroundRefresh: false,
      maxAgeSeconds: 0.01,
    };
    let update = false;
    let addOrUpdateRepositoryQueryCache = false;
    if (event.action === 'created') {
      console.log(`repo created: ${event.repository.full_name} ${event.repository.private === 'private' ? 'private' : 'public'} by ${event.sender.login}`);
      addOrUpdateRepositoryQueryCache = true;
      update = true;
    } else if (event.action === 'deleted') {
      console.log(`repo DELETED: ${event.repository.full_name} ${event.repository.private === 'private' ? 'private' : 'public'} by ${event.sender.login}`);
      update = true;
      const repositoryIdAsString = event.repository.id.toString();
      const organizationIdAsString = event.organization.id.toString();
      try {
        if (organizationIdAsString === organization.id.toString() && queryCache && queryCache.supportsOrganizationMembership) {
          // TODO: Verify what happens to forks...
          await queryCache.removeRepository(organizationIdAsString, repositoryIdAsString);
        }
      } catch (queryCacheError) {
        console.dir(queryCacheError);
      }
    } else if (event.action === 'publicized') {
      console.log('a repo went public!');
      addOrUpdateRepositoryQueryCache = true;
    } else if (event.action === 'privatized') {
      addOrUpdateRepositoryQueryCache = true;
    } else if (event.action === 'edited') {
      addOrUpdateRepositoryQueryCache = true;
    } else if (event.action === 'renamed') {
      addOrUpdateRepositoryQueryCache = true;
    } else if (event.action === 'archived') {
      addOrUpdateRepositoryQueryCache = true;
    } else if (event.action === 'unarchived') {
      addOrUpdateRepositoryQueryCache = true;
    } else {
      console.log(`repository event not being intercepted: ${event.action}`);
    }
    if (addOrUpdateRepositoryQueryCache) {
      const repositoryIdAsString = event.repository.id.toString();
      const organizationIdAsString = event.organization.id.toString();
      try {
        if (organizationIdAsString === organization.id.toString() && queryCache && queryCache.supportsOrganizationMembership) {
          // FYI: forked repositories do not cause upstream org hooks to fire, but
          // by protecting against the org ID being the same as the webhook, we make
          // sure to not cause confusion in the query cache
          await queryCache.addOrUpdateRepository(organizationIdAsString, repositoryIdAsString, event.repository);
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
    // Immediately, to help delete the ticket
    return true;
  }
}
