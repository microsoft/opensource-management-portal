//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';

import MockMailService from './mockMailService.js';
import SmtpMailService from './smtpMailService.js';
import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment.js';
import type { AppInsightsTelemetryClient, IProviders, SiteConfiguration } from '../../interfaces/index.js';
import ConsoleMailService from './consoleMailService.js';

export interface IMail {
  from?: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  content?: any;
  subject?: string;
  category?: string[];
  correlationId?: string;
  senderProfile?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
  linkedResources?: MailAttachment[];
}

export type MailAttachment = {
  name: string;
  contentId: string;
  contentType: string;
  base64Value: string;
};

export async function createMailAttachment(
  localPath: string,
  name: string,
  contentType: string,
  contentId?: string
): Promise<MailAttachment> {
  const realContentId = contentId || randomUUID();
  const content = await fs.readFile(localPath, 'base64');
  return {
    name,
    contentId: realContentId,
    contentType,
    base64Value: content,
  };
}

export function createMailAttachmentFromBase64(
  base64contents: string,
  name: string,
  contentType: string,
  contentId?: string
): MailAttachment {
  const realContentId = contentId || randomUUID();
  return {
    name,
    contentId: realContentId,
    contentType,
    base64Value: base64contents,
  };
}

export interface IMailProvider {
  info: string;
  sendMail(insights: AppInsightsTelemetryClient, mail: IMail): Promise<any>;
  html: boolean;
  getSentMessages(): any[];
  initialize(): Promise<string | void>;
}

export function isOverridingRecipients(config: SiteConfiguration) {
  return !!config.mail.debug.overrideRecipient;
}

function patchOverride(provider, newToAddress, htmlOrNot) {
  const sendMail = provider.sendMail.bind(provider);
  provider.sendMail = (insights: AppInsightsTelemetryClient, mailOptions: IMail): Promise<any> => {
    let originalTo = mailOptions.to;
    if (typeof originalTo !== 'string' && originalTo && Array.isArray(originalTo) && originalTo.join) {
      originalTo = originalTo.join(', ');
    }
    if (!mailOptions.content) {
      mailOptions.content = '';
    }
    const originalSubject = mailOptions.subject;
    mailOptions.subject = '[SAMPLE] ' + originalSubject;
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
    // does the htmlOrNot value include </html> ?
    const htmlOrNot =
      typeof initialContent === 'string' &&
      initialContent.includes('</html>') &&
      initialContent.includes('</body>');
    // if HTML, append the message before the ending </body> tag.
    const bodyEnd = initialContent.lastIndexOf('</body>');
    if (htmlOrNot && bodyEnd > -1) {
      mailOptions.content = `${initialContent.slice(0, bodyEnd)}<p><em>${redirectMessage}</em></p>${initialContent.slice(bodyEnd)}`;
    } else {
      mailOptions.content = `${initialContent}\n${redirectMessage}\n`;
    }
    return sendMail(mailOptions);
  };
  return provider;
}

export function createMailProviderInstance(providers: IProviders, config: SiteConfiguration): IMailProvider {
  const deployment = getCompanySpecificDeployment();
  let mailProvider: IMailProvider = null;
  const mailConfig = config.mail;
  if (deployment?.features?.mailProvider?.tryCreateInstance) {
    mailProvider = deployment.features.mailProvider.tryCreateInstance(providers, config);
    if (mailProvider) {
      if (mailConfig.debug.overrideRecipient) {
        patchOverride(mailProvider, mailConfig.debug.overrideRecipient, mailProvider.html);
      }
      return mailProvider;
    }
  }
  if (mailConfig === undefined) {
    return;
  }
  const provider = mailConfig.provider;
  if (!provider) {
    return;
  }
  switch (provider) {
    case 'smtpMailService': {
      mailProvider = new SmtpMailService(mailConfig);
      break;
    }
    case 'mockMailService': {
      mailProvider = new MockMailService(config);
      break;
    }
    case 'console': {
      mailProvider = new ConsoleMailService(config);
      break;
    }
    default: {
      throw new Error(
        `The mail provider "${mailConfig.provider}" is not implemented or configured at this time.`
      );
    }
  }
  if (mailConfig.debug.overrideRecipient) {
    patchOverride(mailProvider, mailConfig.debug.overrideRecipient, mailProvider.html);
  }
  return mailProvider;
}
