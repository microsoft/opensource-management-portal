//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import MockMailService from './mockMailService';
import IrisMailService from './customMailService';
import SmtpMailService from './smtpMailService';

export interface IMail {
  from?: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  content?: any;
  subject?: string;
  category?: string[];
  correlationId?: string;
}

export interface IMailProvider {
  info: string;
  sendMail(mail: IMail): Promise<any>;
  html: boolean;
  getSentMessages(): any[];
}

function patchOverride(provider, newToAddress, htmlOrNot) {
  const sendMail = provider.sendMail.bind(provider);
  provider.sendMail = (mailOptions: IMail): Promise<any> => {
    let originalTo = mailOptions.to;
    if (typeof originalTo !== 'string' && originalTo.join) {
      originalTo = originalTo.join(', ');
    }
    if (!mailOptions.content) {
      mailOptions.content = '';
    }
    mailOptions.to = newToAddress;
    if (mailOptions.cc) {
      if (typeof mailOptions.cc === 'string') {
        mailOptions.cc = [mailOptions.cc];
      }
      if (Array.isArray(mailOptions.cc) && mailOptions.cc.length) {
        originalTo += ` (CC: ${mailOptions.cc.join(', ')})`;
        mailOptions.cc = null;
      }
    }
    if (mailOptions.bcc) {
      if (typeof mailOptions.bcc === 'string') {
        mailOptions.bcc = [mailOptions.bcc];
      }
      if (Array.isArray(mailOptions.bcc) && mailOptions.bcc.length) {
        originalTo += ` (BCC: ${mailOptions.bcc.join(', ')})`;
        mailOptions.bcc = null;
      }
    }
    const initialContent = mailOptions.content;
    const redirectMessage = `This mail was intended for ${originalTo} but was instead sent to ${newToAddress} per a configuration override.\n`;
    mailOptions.content = htmlOrNot ? `<p><em>${redirectMessage}</em></p>\n${initialContent}` : `${redirectMessage}\n${initialContent}`;
    return sendMail(mailOptions);
  };
  return provider;
}

export default function createMailProviderInstance(config): IMailProvider {
  const mailConfig = config.mail;
  if (mailConfig === undefined) {
    return;
  }
  const provider = mailConfig.provider;
  if (!provider) {
    return;
  }
  let mailProvider: IMailProvider = null;
  switch (provider) {
    case 'customMailService': {
      mailProvider = new IrisMailService(config);
      break;
    }
    case 'smtpMailService': {
      mailProvider = new SmtpMailService(config);
      break;
    }
    case 'mockMailService': {
      mailProvider = new MockMailService(config);
      break;
    }
    default: {
      throw new Error(`The mail provider "${mailConfig.provider}" is not implemented or configured at this time.`);
    }
  }
  if (mailConfig.overrideRecipient) {
    patchOverride(mailProvider, mailConfig.overrideRecipient, mailProvider.html);
  }
  return mailProvider;
}
