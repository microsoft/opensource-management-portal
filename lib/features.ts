//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { IProviders } from '../interfaces/providers.js';

export type SiteStaticFeatures = {
  github: {
    organizations: {
      annotations: {
        enabled: boolean;
      };
    };
  };
};

export function getSiteStaticFeatures(providers: IProviders): SiteStaticFeatures {
  const { organizationAnnotationsProvider } = providers;

  return {
    github: {
      organizations: {
        annotations: {
          enabled: !!organizationAnnotationsProvider,
        },
      },
    },
  };
}
