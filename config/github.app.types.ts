//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubRootApp = {
  app: ConfigGitHubApp;
};

export type ConfigGitHubAppGeneric = {
  clientId: string;
  clientSecret: string;
  appId: string;
  appKey: string;
  appKeyFile: string;
  appKeyRemoteJwt: string;
  webhookSecret: string;
  slug: string;
  description: string;
};

export type ConfigGitHubApp = {
  actions: ConfigGitHubAppGeneric;
  data: ConfigGitHubAppGeneric;
  jobs: ConfigGitHubAppGeneric;
  onboarding: ConfigGitHubAppGeneric;
  operations: ConfigGitHubAppGeneric;
  security: ConfigGitHubAppGeneric;
  ui: ConfigGitHubAppGeneric;
  updates: ConfigGitHubAppGeneric;
};
