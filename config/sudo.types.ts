//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootSudo = {
  sudo: ConfigSudo;
};

export type ConfigSudo = {
  organization: {
    off: boolean;
    defaultProviderName: string;
    allowUniqueProvidersByOrganization: boolean;
  };

  portal: {
    off: boolean;
    force: boolean;
    providerName: string;

    securityGroup: {
      id: string;
    };
  };
};
