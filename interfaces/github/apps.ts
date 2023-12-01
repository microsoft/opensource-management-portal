//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export interface IGitHubAppInstallationPermissions {
  issues: string; // write, ?
  metadata: string; // read, ...
  administration: string; // write, ...
}

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
  permissions: IGitHubAppInstallationPermissions;
  events: string[];
  repository_selection: string;
  created_at: string;
  updated_at: string;
}
