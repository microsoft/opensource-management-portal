//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { GitHubAppPermission } from '../../lib/github/types.js';

export type GitHubAppInstallationPermissions = {
  issues: GitHubAppPermission | string;
  members: GitHubAppPermission | string;
  contents: GitHubAppPermission | string;
  metadata: GitHubAppPermission | string;
  pull_requests: GitHubAppPermission | string;
  administration: GitHubAppPermission | string;
  repository_hooks: GitHubAppPermission | string;
  organization_plan: GitHubAppPermission | string;
  organization_hooks: GitHubAppPermission | string;
  organization_user_blocking: GitHubAppPermission | string;
  organization_administration: GitHubAppPermission | string;
};

export interface IGitHubWebhookEnterprise {
  id: number;
  slug: string;
  name: string;
  node_id: string;
  avatar_url: string;
  description: string;
  website_url: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface IGitHubAppInstallation {
  id: number;
  account: {
    login: string;
    id: number;
  };
  app_id: number;
  target_id: number;
  target_type: string;
  permissions: GitHubAppInstallationPermissions;
  events: string[];
  repository_selection: string;
  created_at: string;
  updated_at: string;
}
