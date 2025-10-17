//
// Copyright (c) Microsoft. All Rights Reserved.
//

import type { GitHubRepositoryBaseDetails } from '../../interfaces/index.js';

// there's probably an octokit thing we should use here instead

export type GitHubWebhookMember = {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  type: 'User';
  site_admin: boolean;
};

export type GitHubWebhookSender = GitHubWebhookMember;

export type GitHubWebhookEnterprise = {
  id: number;
  slug: string;
  name: string;
  node_id: string;
  avatar_url: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type GitHubWebhookInstallation = {
  id: number;
  node_id: string;
};

export type GitHubWebhookOrganization = {
  login: string;
  id: number;
  node_id: string;
  url: string;
  repos_url: string;
  events_url: string;
  hooks_url: string;
  issues_url: string;
  members_url: string;
  public_members_url: string;
  avatar_url: string;
  description: string;
};

export type GitHubWebhookRepository = GitHubRepositoryBaseDetails;
