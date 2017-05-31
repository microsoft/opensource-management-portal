//
// Copyright (c) Microsoft. All rights reserved.
//

'use strict';

const uuid = require('node-uuid');

function sendMail(sentMessages, mailConfig, mailOptions, callback) {
  const receipt = Object.assign({
    id: uuid.v4(),
  }, mailOptions);
  sentMessages.push(receipt);
  callback(null, receipt.id);
}

module.exports = function createCustomMailService(config) {
  const sentMessages = [];
  const customServiceConfig = config.mail.customService;
  const appVersion = config.logging.version;
  if (customServiceConfig.version !== 'prototype') {
    throw new Error(`The custom mail service version "${customServiceConfig.version}" is not supported in this release.`);
  }
  return {
    info: `mockMailService-${customServiceConfig.version} v${appVersion}`,
    sendMail: sendMail.bind(undefined, sentMessages, customServiceConfig),
    html: true,

    // testability:
    getSentMessages: function () {
      return sentMessages;
    }
  };
};
