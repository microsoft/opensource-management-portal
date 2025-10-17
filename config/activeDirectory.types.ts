//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { EntraIdClientType } from '../interfaces/enums.js';

export type ConfigRootActiveDirectory = {
  activeDirectory: ConfigActiveDirectory;
};

export type ConfigActiveDirectory = {
  application: {
    managedIdentity: {
      clientId: string;
    };
    deployedClientId: string;
    nextGenerationApplicationRegistration: {
      clientId: string;
      optionalClientSecret: string;
      tenantId: string;
      useDeveloperCli: boolean;
      developerCliSubscriptionId?: string;
    };
    fallbackIfSingleApplicationRegistration: {
      clientId: string;
      clientSecret: string;
      tenantId: string;
      useDeveloperCli: boolean;
    };
  };

  api: {
    authentication: {
      provider: string;
    };
  };

  authentication: {
    blockGuestUserTypes: boolean;
    blockGuestSignIns: boolean;
    allowedTenantIds: string;
    issuer: string;
    isMultiTenant: boolean;

    entraManagedIdentityAuthentication: {
      isMultiTenant: boolean;
      redirectUrl: string;

      applicationRegistration: {
        authenticationType: EntraIdClientType;
        clientId: string;
        clientSecret: string;
        tenantId: string;
      };
    };

    fallbackIfSingleApplicationRegistration: {
      clientId: string;
      clientSecret: string;
      tenantId: string;
    };

    developmentTenantRewriting: ConfigActiveDirectoryRewriting;
  };
};

export type ConfigActiveDirectoryRewriting = {
  enabled: boolean;
  callbackStarts: string;
  from: {
    tenant: string;
    upn: string;
    id: string;
  };
  to: {
    tenant: string;
    upn: string;
    id: string;
  };
};
