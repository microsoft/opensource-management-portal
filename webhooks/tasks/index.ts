//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import AuditLogRecorderWebhookProcessor from './auditLog';
import AutomaticTeamsWebhookProcessor from './automaticTeams';
import MembershipWebhookProcessor from './membership';
import MemberWebhookProcessor from './member';
import OrganizationWebhookProcessor from './organization';
import RepositoryWebhookProcessor from './repository';
import TeamWebhookProcessor from './team';

import { WebhookProcessor } from '../organizationProcessor';

const tasks: WebhookProcessor[] = [
  new AuditLogRecorderWebhookProcessor(),
  new AutomaticTeamsWebhookProcessor(),
  new MemberWebhookProcessor(),
  new MembershipWebhookProcessor(),
  new OrganizationWebhookProcessor(),
  new RepositoryWebhookProcessor(),
  new TeamWebhookProcessor(),
];

export const Tasks = tasks;
export default Tasks;
