//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export enum AccountJsonFormat {
  GitHub = 'github',
  UplevelWithLink = 'github+link',
  GitHubDetailedWithLink = 'detailed+link',
}

export interface IAccountBasics {
  id: number;
  login: string;
  avatar_url: string;
  created_at: any;
  updated_at: any;
}

export interface IGitHubAccountDetails {
  login: string;
  id: number;
  name: string;
  node_id: string;
  avatar_url: string;
  gravatar_id?: string;
  url: string; // https://api.github.com/users/octocat
  html_url: string; // https://github.com/octocat
  followers_url: string;
  following_url: string;
  gists_url: string;
  starred_url: string;
  subscriptions_url: string;
  organizations_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  site_admin: boolean;
  company: string;
  blog: string;
  location: string;
  email: string;
  hireable: boolean;
  bio: string;
  twitter_username: string;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  created_at: string;
  updated_at: string;
  private_gists: number;
  total_private_repos: number;
  owned_private_repos: number;
  disk_usage: number;
  collaborators: number;
  two_factor_authentication: boolean;
  plan?: {
    name: string;
  };
}
