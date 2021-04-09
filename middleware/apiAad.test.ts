//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { getAadApiConfiguration } from './apiAad';

describe('AAD API Configuration', () => {
  let standardConfig = {};
  let stringConfig = {};

  beforeEach(() => {
    standardConfig = {
      microsoft: {
        api: {
          aad: {
            authorizedTenants: 't1,t2',
            apiAppScope: 'api://app',
            approvedApps: {
              scopes: {
                create: {
                  repos: ['a1'],
                },
              },
            },
            approvedOids: {
              scopes: {
                create: {
                  repos: ['o1'],
                },
              },
            },
          },
        },
      },
    };

    stringConfig = {
      microsoft: {
        api: {
          aad: {
            authorizedTenants: 't1,t2',
            apiAppScope: 'api://app',
            approvedApps: {
              scopes: {
                create: {
                  repos: 'a1,a2,a3',
                },
              },
            },
            approvedOids: {
              scopes: {
                create: {
                  repos: 'o1,o2',
                },
              },
            },
          },
        },
      },
    };
  });

  test('OID and app ID string values parse', () => {
    getAadApiConfiguration(stringConfig);
  });
  test('OID and app ID arrays work', () => {
    getAadApiConfiguration(standardConfig);
  });

});
