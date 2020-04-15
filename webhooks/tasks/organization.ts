//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["dir", "log"] }] */

import { Operations } from "../../business/operations";
import { Organization, OrganizationMembershipRole } from "../../business/organization";
import { IProviders } from "../../transitional";
import { WebhookProcessor } from "../organizationProcessor";

// NOTE: unfortunately role changes from admin->member or member->admin do not fire GitHub hooks

function getRoleFromString(role: string): OrganizationMembershipRole {
  switch (role) {
    case 'admin':
      return OrganizationMembershipRole.Admin;
    case 'member':
      return OrganizationMembershipRole.Member;
    default:
      throw new Error(`OrganizationMembershipRole ${role} is not supported`);
  }
}

export default class OrganizationWebhookProcessor implements WebhookProcessor {
  filter(data: any) {
    let eventType = data.properties.event;
    return eventType === 'organization';
  }

  async run(operations: Operations, organization: Organization, data: any): Promise<boolean> {
    const providers = operations.providers as IProviders;
    const queryCache = providers.queryCache;

    const event = data.body;
    let refresh = false;
    if (event.action === 'member_invited') {
      if (!event.invitation || !event.invitation.inviter || !event.invitation.inviter.login) {
        // should no longer be an issue per GitHub in September 2019
      }
      console.log(`org member invite by ${event.invitation.inviter.login}; ghu ${event.invitation.login} role ${event.invitation.role} ghid ${event.invitation.id} org: ${event.organization.login}`);
    } else if (event.action === 'member_added') {
      console.log(`org member added; ghu ${event.membership.user.login} role ${event.membership.role} state ${event.membership.state} ghid ${event.membership.user.id} org: ${event.organization.login}`);
      if (event.membership.state === 'active') {
        const userIdAsString = event.membership.user.id.toString();
        const organizationIdAsString = event.organization.id.toString();
        try {
          if (queryCache && queryCache.supportsOrganizationMembership) {
            const role = getRoleFromString(event.membership.role);
            await queryCache.addOrUpdateOrganizationMember(organizationIdAsString, role, userIdAsString);
          }
        } catch (queryCacheError) {
          console.dir(queryCacheError);
        }
      }
      refresh = true;
    } else if (event.action === 'member_removed') {
      console.log(`org member REMOVED; ghu ${event.membership.user.login} role ${event.membership.role} state ${event.membership.state} ghid ${event.membership.user.id} org: ${event.organization.login}`);
      const userIdAsString = event.membership.user.id.toString();
      const organizationIdAsString = event.organization.id.toString();
      try {
        if (queryCache && queryCache.supportsOrganizationMembership) {
          await queryCache.removeOrganizationMember(organizationIdAsString, userIdAsString);
        }
      } catch (queryCacheError) {
        console.dir(queryCacheError);
      }
      refresh = true;
    } else {
      console.dir(data);
    }
    if (refresh) {
      // const orgName = organization.name;
      // console.log(`refreshing ${orgName} org members list`);
      // const immediateRefreshOptions = {
      //   backgroundRefresh: false,
      //   maxAgeSeconds: 0.01,
      // };
      // return organization.getMembers(immediateRefreshOptions).then(ok => {
      //   console.log(`refreshed membership list for the org ${orgName}, will refresh x-org immediately`);
      //   return operations.getMembers(immediateRefreshOptions).then(done => {
      //     console.log('refreshed x-org memberships');
      //   });
      // }).catch(error => {
      //   // ignore error
      //   return callback();
      // });
    }

    return true;
  }
}
