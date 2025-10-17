//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IMailProvider, IMail } from './index.js';

import nodemailer from 'nodemailer';

export default class SmtpMailService implements IMailProvider {
  private _config: any;

  html: true;
  info: 'SMTP mail service';

  constructor(mailConfig: any) {
    this._config = mailConfig;
  }

  getSentMessages() {
    return []; // this provider does not support mocks
  }

  async initialize() {}

  async sendMail(mail: IMail): Promise<any> {
    if (!this._config.smtpMailService) {
      throw new Error('SMTP Mail configuration not given, mail sending failed');
    }
    const transporter = nodemailer.createTransport(this._config.smtpMailService);
    try {
      const info = await transporter.sendMail({
        to: mail.to,
        cc: mail.cc,
        bcc: mail.bcc,
        from: mail.from || this._config.from,
        subject: mail.subject,
        html: mail.content,
      });
      if (info.rejected.length > 0) {
        console.warn(`Following recipient addresses were rejected by the server:\n${info.rejected}`);
      }
      return info.response ? info.response : null;
    } catch (err) {
      throw err;
    }
  }
}
