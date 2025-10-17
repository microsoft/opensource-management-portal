//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import AuditLogRecorderWebhookProcessor from './auditLog.js';
import AutomaticTeamsWebhookProcessor from './automaticTeams.js';
import MembershipWebhookProcessor from './membership.js';
import MemberWebhookProcessor from './member.js';
import OrganizationWebhookProcessor from './organization.js';
import RepositoryWebhookProcessor from './repository.js';
import TeamWebhookProcessor from './team.js';

import { WebhookProcessor } from '../organizationProcessor.js';

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
