//
// Copyright (c) Microsoft. All rights reserved.
//

// customMailService.js: THIS FILE IS FOR INTERNAL USE AND SHOULD NOT BE OPEN SOURCED AT THIS TIME

'use strict';

const request = require('request');

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
    sendImmediately: true,
  };
  let from = pop(options, 'from') || mailConfig.from;
  let to = pop(options, 'to');
  if (!to) {
    return callback(new Error('The e-mail must have a receipient.'));
  }
  if (typeof to !== 'string' && to.join) {
    to = to.join(', ');
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
  if (cc && typeof cc !== 'string' && cc.join) {
    cc = cc.join(', ');
  }
  const classification = pop(options, 'classification');
  if (!classification) {
    return callback(new Error('The custom mail service provider requires a classification value.'));
  }
  if (classification !== 'warning' && classification !== 'information' && classification !== 'action') {
    return callback(new Error(`The custom mail service provider does not recognize the classification value of "${classification}".`));
  }
  // Optional template fields: headline, reason
  const headline = pop(options, 'headline');
  const reason = pop(options, 'reason');
  const service = pop(options, 'service');
  const correlationId = pop(options, 'correlationId');
  const customMailPost = {
    to: to,
    cc: cc,
    from: from,
    subject: subject,
    body: content,
    headline: headline,
    reason: reason,
    service: service,
    template: classification,
    correlationId: correlationId,
  };
  request.post({
    auth: auth,
    form: customMailPost,
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
  if (customServiceConfig.version !== 'prototype') {
    throw new Error(`The custom mail service version "${customServiceConfig.version}" is not supported in this release.`);
  }
  config.mail.customService.username = 'custom';
  return {
    info: `customMailService-${customServiceConfig.version} v${appVersion}`,
    html: true,
    sendMail: sendMail.bind(undefined, config.mail),
  };
};
