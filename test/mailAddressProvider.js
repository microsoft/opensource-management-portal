//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const assert = require('chai').assert;
const mailAddressProvider = require('../lib/mailAddressProvider/');

const fakeMailAddressProviderName = 'mockMailAddressProvider';

function createOptions() {
  return {
    config: {
      mailAddresses: {
        provider: fakeMailAddressProviderName,
      },
    },
  };
}

describe('mailAddressProvider', () => {
  describe('factory', () => {

    it('can create a factory by configuration', () => {
      const options = createOptions();
      mailAddressProvider(options, (error, provider) => {
        assert.isNull(error, 'no error');
        assert.isDefined(provider, 'provider is created');
      });
    });

    it('mock end-to-end works', () => {
      const options = createOptions();
      mailAddressProvider(options, (error, provider) => {
        provider.getUpnToEmails().set('hello@corp.contoso.com', 'email@contoso.com');

        provider.getAddressFromUpn('hello@corp.contoso.com', (error, address) => {
          assert.isDefined(address, 'address is received');
          assert.equal('email@contoso.com', address, 'address returned');
        });
      });
    });

    it('throws an error when the provider is not supported', () => {
      const options = createOptions();
      options.config.mailAddresses.provider = 'providerDoesNotExist';
      mailAddressProvider(options, (error, provider) => {
        assert.isDefined(error, 'provider did not exist, error set');
        assert.isUndefined(provider, 'provider was not created');
      });
    });
  });
});
