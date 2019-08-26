//
// Copyright (c) Microsoft. All rights reserved.
//

// customMailService.js: THIS FILE IS FOR INTERNAL USE AND SHOULD NOT BE OPEN SOURCED AT THIS TIME

'use strict';

import request = require('request');

function pop(obj, key) {
  const val = obj[key];
  delete obj[key];
  return val;
}

function sendMail(mailConfig, options, callback) {
  const serviceUrl = mailConfig.customService.url;
  if (!serviceUrl) {
    return callback(new Error('No custom mail service provider endpoint configured.'));
  }
  const auth = {
    username: mailConfig.customService.username,
    password: mailConfig.customService.apiKey,
  };
  let from = pop(options, 'from') || mailConfig.from;
  let to = pop(options, 'to');
  if (!to) {
    return callback(new Error('The e-mail must have a recipient.'));
  }
  if (typeof to === 'string') {
    to = [ to ];
  }
  const subject = pop(options, 'subject');
  if (!subject) {
    return callback(new Error('The e-mail must have a subject.'));
  }
  const content = pop(options, 'content');
  if (!content) {
    return callback(new Error('A message must include content.'));
  }
  let cc = pop(options, 'cc');
  if (cc && typeof cc === 'string') {
    cc = [ cc ];
  }
  let bcc = pop(options, 'bcc');
  if (bcc && typeof bcc === 'string') {
    bcc = [ bcc ];
  }
  let category = pop(options, 'category');
  const correlationId = pop(options, 'correlationId');
  cc = cc || [];
  bcc = bcc || [];
  const customMailPost = {
    mail: {
      to,
      cc,
      bcc,
      from,
      subject,
      html: content,
      correlationId,
    },
  };
  if (category) {
    customMailPost.mail['category'] = category;
  }
  request.post({
    auth: auth,
    json: true,
    body: customMailPost,
    headers: {
      'mail-provider': 'iris',
    },
    url: serviceUrl,
  }, (httpError, response, body) => {
    if (response.statusCode >= 300) {
      httpError = new Error(`Mail could not be sent, the mail service returned a status code of ${response.statusCode}`);
    }
    callback(httpError || null, httpError ? null : body);
  });
}

module.exports = function createCustomMailService(config) {
  const customServiceConfig = config.mail.customService;
  const appVersion = config.logging.version;
  if (customServiceConfig.version !== 'latest') {
    throw new Error(`The custom mail service version "${customServiceConfig.version}" is not supported in this release.`);
  }
  config.mail.customService.username = 'custom';
  return {
    info: `customMailService-${customServiceConfig.version} v${appVersion}`,
    html: true,
    sendMail: sendMail.bind(undefined, config.mail),
  };
};
