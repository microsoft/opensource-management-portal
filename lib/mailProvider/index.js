//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const providers = [
  'customMailService',
  'mockMailService',
];

// Providers contract:
// - sendMail function(message, callback): sends mail
// - html property: whether or not the provider sends HTML mail
// - info property: version and name info to use in any logging

function patchOverride(provider, newToAddress, htmlOrNot) {
  const sendMail = provider.sendMail;
  provider.sendMail = (mailOptions, callback) => {
    let originalTo = mailOptions.to;
    if (typeof originalTo !== 'string' && originalTo.join) {
      originalTo = originalTo.join(', ');
    }
    if (!mailOptions.content) {
      mailOptions.content = '';
    }
    mailOptions.to = newToAddress;
    const initialContent = mailOptions.content;
    const redirectMessage = `This mail was intended for "${originalTo}" but was instead sent to "${newToAddress}" per a configuration override.\n`;
    mailOptions.content = htmlOrNot ? `<p><em>${redirectMessage}</em></p>\n${initialContent}` : `${redirectMessage}\n${initialContent}`;
    sendMail(mailOptions, callback);
  };
  return provider;
}

module.exports = function createMailProviderInstance(config, callback) {
  const mailConfig = config.mail;
  if (mailConfig === undefined) {
    return callback();
  }
  const provider = mailConfig.provider;
  if (!provider) {
    return callback();
  }
  let found = false;
  providers.forEach((supportedProvider) => {
    if (supportedProvider === provider) {
      found = true;
      const providerInstance = require(`./${supportedProvider}`)(config);
      if (mailConfig.overrideRecipient) {
        patchOverride(providerInstance, mailConfig.overrideRecipient, providerInstance.html);
      }
      return callback(null, providerInstance);
    }
  });
  if (found === false) {
    return callback(new Error(`The mail provider "${mailConfig.provider}" is not implemented or configured at this time.`));
  }
};
