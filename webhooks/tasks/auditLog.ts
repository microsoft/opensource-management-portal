//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["dir", "log"] }] */

// AUDIT LOG: this capability is offline since the original data store was not ideal.
// This should be rewritten to use the entity concept, and integrate with the newer
// GitHub Enterprise Cloud capability of using GraphQL to hit the official audit log
// for organizations, and also to import JSON-based audit export files.

'use strict';

import { WebhookProcessor } from '../organizationProcessor';
import { Operations } from '../../business/operations';
import { Organization } from '../../business/organization';

interface IAuditDocument {
  pk: string;
  type: string;
  provider: string;
  service: string;
  id: string;
  action: string;
  event: string;
  actor: any;
  scope?: string;
  membership?: any;
  member?: any;
  team?: any;
  changes?: any;
  organization?: any;
  timestamp?: any;
  repository?: any;
}

const eventTypes = new Set([
  'membership',
  'member',
  'organization',
  'repository',
  'team',
]);

async function runAsync(operations: Operations, organization: Organization, data: any) {
  const properties = data.properties;
  const body = data.body;
  // const document : IAuditDocument = {
  //   type: 'event',
  //   provider: 'github',
  //   service: 'repos',
  //   id: properties.delivery,
  //   action: body.action,
  //   event: properties.event,
  //   actor: {
  //     id: body.sender.id,
  //     login: body.sender.login,
  //   },
  // };
  // if (body.scope) {
  //   document.scope = body.scope;
  // }
  // if (body.membership) {
  //   document.membership = {
  //     state: body.membership.state,
  //     role: body.membership.role,
  //     user: {
  //       id: body.membership.user.id,
  //       login: body.membership.user.login,
  //     },
  //   };
  // }
  // if (body.member) {
  //   document.member = {
  //     id: body.member.id,
  //     login: body.member.login,
  //   };
  // }
  // if (body.team) {
  //   document.team = {
  //     id: body.team.id,
  //     name: body.team.name,
  //   };
  // }
  // if (body.changes) {
  //   document.changes = body.changes;
  // }
  // document.timestamp = properties.started;
  // if (body.organization) {
  //   document.organization = {
  //     id: body.organization.id,
  //     login: body.organization.login,
  //   };
  // }
  // if (body.repository) {
  //   document.repository = {
  //     id: body.repository.id,
  //     name: body.repository.name,
  //   };
  // }
}

export default class AuditLogRecorderWebhookProcessor implements WebhookProcessor {
  filter(data: any) {
    let eventType = data.properties.event;
    console.log(eventType);
    // console.dir(data);
    return eventTypes.has(eventType);
  }

  async run(operations: Operations, organization: Organization, data: any): Promise<boolean> {
    const result = await runAsync(operations, organization, data);
    return true;
  }
}
