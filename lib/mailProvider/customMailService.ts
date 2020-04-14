//
// Copyright (c) Microsoft.
//

// customMailService.js: THIS FILE IS FOR INTERNAL USE AND SHOULD NOT BE OPEN SOURCED AT THIS TIME

'use strict';

import request = require('request');
import { IMailProvider, IMail } from '.';

function pop(obj, key) {
  const val = obj[key];
  delete obj[key];
  return val;
}

export default class IrisMailService implements IMailProvider {
  private _config: any;

  html: true;
  info: string;

  getSentMessages() {
    return []; // this provider does not support mocks
  }

  constructor(config: any) {
    const customServiceConfig = config.mail.customService;
    const appVersion = config.logging.version;
    if (customServiceConfig.version !== 'latest') {
      throw new Error(`The custom mail service version "${customServiceConfig.version}" is not supported in this release.`);
    }
    config.mail.customService.username = 'custom';
    this.info = `customMailService-${customServiceConfig.version} v${appVersion}`;
    this._config = config;
  }

  async sendMail(mail: IMail): Promise<any> {
    const mailConfig = this._config.mail;
    const serviceUrl = mailConfig.customService.url;
    if (!serviceUrl) {
      throw new Error('No custom mail service provider endpoint configured.');
    }
    const auth = {
      username: mailConfig.customService.username,
      password: mailConfig.customService.apiKey,
    };
    let from = pop(mail, 'from') || mailConfig.from;
    let to = pop(mail, 'to');
    if (!to) {
      throw new Error('The e-mail must have a recipient.');
    }
    if (typeof to === 'string') {
      to = [ to ];
    }
    const subject = pop(mail, 'subject');
    if (!subject) {
      throw new Error('The e-mail must have a subject.');
    }
    const content = pop(mail, 'content');
    if (!content) {
      throw new Error('A message must include content.');
    }
    let cc = pop(mail, 'cc');
    if (cc && typeof cc === 'string') {
      cc = [ cc ];
    }
    let bcc = pop(mail, 'bcc');
    if (bcc && typeof bcc === 'string') {
      bcc = [ bcc ];
    }
    let category = pop(mail, 'category');
    const correlationId = pop(mail, 'correlationId');
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
    await new Promise((resolve, reject) => {
      request.post({
        auth,
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
        return httpError ? reject(httpError) : resolve(body);
      });
    });
  }
}
