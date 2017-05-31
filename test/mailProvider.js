//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const assert = require('chai').assert;
const mailProvider = require('../lib/mailProvider/');

const fakeMailProviderName = 'mockMailService';

const executive = 'ceo@contoso.com';
const developer = 'nobody@nobody.com';

function createMailConfig() {
  return {
    logging: {
      version: '1',
    },
    mail: {
      provider: fakeMailProviderName,
      from: 'tester@contoso.com',
      overrideRecipient: undefined,
      customService: {
        url: 'url',
        apiKey: 'key',
        version: 'prototype',
      }
    },
  };
}

describe('mailProvider', () => {
  describe('factory', () => {

    it('can create a factory by configuration', () => {
      const config = createMailConfig();
      mailProvider(config, (error, provider) => {
        assert.isDefined(provider, 'provider is created');
      });
    });

    it('overriding to works', () => {
      const config = createMailConfig();
      config.mail.overrideRecipient = developer;
      mailProvider(config, (error, provider) => {
        const mail = {
          to: executive,
        };
        provider.sendMail(mail, (sendMail, receipt) => {
          assert.isDefined(receipt, 'mail is sent');
          const messages = provider.getSentMessages();
          assert.strictEqual(messages.length, 1, 'one message was sent');
          const message = messages[0];
          assert.equal(message.id, receipt, 'message ID matches');
          assert.equal(message.to, developer, 'overridden e-mail address is used for TO:');
        });
      });
    });

    it('mock send mail works', () => {
      const config = createMailConfig();
      mailProvider(config, (error, provider) => {
        const mail = {
          to: executive,
        };
        provider.sendMail(mail, (sendMail, receipt) => {
          assert.isDefined(receipt, 'mail is sent');
          const messages = provider.getSentMessages();
          assert.strictEqual(messages.length, 1, 'one message was sent');
          const message = messages[0];
          assert.equal(message.id, receipt, 'message ID matches');
          assert.equal(message.to, executive, 'intended receipient was sent the message');
        });
      });
    });

    it('reports basic provider info and version properties', () => {
      const config = createMailConfig();
      mailProvider(config, (error, provider) => {
        assert.isTrue(provider.info.includes(fakeMailProviderName), 'provider self-registers correctly');
      });
    });

    it('throws an error when the provider is not supported', () => {
      const config = createMailConfig();
      config.mail.provider = 'providerDoesNotExist';
      mailProvider(config, (error, provider) => {
        assert.isDefined(error, 'provider did not exist, error set');
        assert.isUndefined(provider, 'provider was not created');
      });
    });
  });
});
