//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubRootOAuth2 = {
  oauth2: ConfigGitHubOAuth2;
};

export type ConfigGitHubOAuth2 = {
  useCustomerFacingGitHubAppIfPresent: boolean;
  useIncreasedScopeCustomerFacingIfNeeded: boolean;

  clientId: string;
  clientSecret: string;
  callbackUrl: string;
};
