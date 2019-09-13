//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const nodemailer = require('nodemailer');

interface IMailOptions {
  from?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  content: string;
  category?: string[];
  correlationId?: string;
};

async function sendMail(mailConfig, mailOptions: IMailOptions, callback) {

  if (!mailConfig.customSmtpService) {
    return callback(new Error("SMTP Mail configuration not given, mail sending failed"));
  };

  const transporter = nodemailer.createTransport(mailConfig.customSmtpService);
  try {
    const info = await transporter.sendMail({
      to: mailOptions.to,
      cc: mailOptions.cc,
      bcc: mailOptions.bcc,
      from: mailOptions.from || mailConfig.from,
      subject: mailOptions.subject,
      html: mailOptions.content
    });
    if (info.rejected.length > 0) {
      console.warn("Following reciepient addresses were rejected by the server:\n" + info.rejected)
    };
    return callback(null, info.response ? info.response : null);
  } catch (err) {
    return callback(err);
  };
};

module.exports = function createSmtpMailService(config) {
  return {
    info: "SMTP mail service",
    sendMail: sendMail.bind(undefined, config.mail),
    html: true,
  };
};
