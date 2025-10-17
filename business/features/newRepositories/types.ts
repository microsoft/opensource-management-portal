//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { GitHubRepositoryBaseDetails } from '../../../interfaces/index.js';
import type {
  GitHubWebhookEnterprise,
  GitHubWebhookInstallation,
  GitHubWebhookOrganization,
  GitHubWebhookSender,
} from '../../webhooks/types.js';

// Probably a better typed Octokit thing to use instead...

export type GitHubWebhookRepositoryEventBody = {
  action:
    | 'created'
    | 'deleted'
    | 'archived'
    | 'unarchived'
    | 'transferred'
    | 'publicized'
    | 'privatized'
    | 'renamed'
    | 'edited';
  repository: GitHubRepositoryBaseDetails;
  changes?: {
    owner?: {
      from: {
        user?: GitHubWebhookSender;
        organization?: GitHubWebhookOrganization;
      };
    };
  };
  organization: GitHubWebhookOrganization;
  enterprise: GitHubWebhookEnterprise;
  sender: GitHubWebhookSender;
  installation: GitHubWebhookInstallation;
};
