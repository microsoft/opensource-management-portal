//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubRootCodespaces = {
  codespaces: ConfigGitHubCodespaces;
};

export type ConfigGitHubCodespaces = {
  block: boolean;
  connected: boolean;
  desktop: boolean;
  name: string;
  forwardingDomain: string;
  authentication: {
    port: string;
    github: {
      enabled: boolean;
      clientId: string;
      clientSecret: string;
      impersonateOverrideEmuAccount: {
        enabled: boolean;
        login: string;
      };
    };
    'entra-id': {
      enabled: boolean;
    };
    aad: {
      enabled: boolean;
    };
  };
};
