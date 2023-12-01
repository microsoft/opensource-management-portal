//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IMailProvider, IMail } from '.';
import { ServiceBusClient, ServiceBusMessage } from '@azure/service-bus';

export default class AzureServiceBus implements IMailProvider {
  private _config: any;

  html: true;
  info: 'Azure Service Bus';

  constructor(config: any) {
    this._config = config;
  }

  getSentMessages() {
    return []; // this provider does not support mocks
  }

  flatten(stringOrArray) {
    // the logic app expects a string of emails separated by ';'
    if (typeof stringOrArray === 'string' && stringOrArray.length) {
      return stringOrArray;
    }

    if (Array.isArray(stringOrArray)) {
      // replace empty arrays with undefined
      return stringOrArray.length ? stringOrArray.join('; ') : undefined;
    }

    return undefined;
  }

  transform(mail: IMail): IMail {
    mail.to = this.flatten(mail.to);
    mail.cc = this.flatten(mail.cc);
    mail.bcc = this.flatten(mail.bcc);

    return mail;
  }

  async initialize() {}

  async sendMail(mail: IMail): Promise<any> {
    const {
      mail: { azureServiceBus: config },
      brand: { supportMail },
    } = this._config;

    if (!this._config.azureServiceBus) {
      throw new Error('Azure Service bus configuration not provided, mail sending failed');
    }

    mail = this.transform(mail);

    if (!mail.to) {
      if (supportMail) {
        mail.to = supportMail;
      } else {
        throw new Error('No email recipient provided');
      }
    }

    const client = new ServiceBusClient(this._config.azureServiceBus.connectionString);
    const sender = client.createSender(this._config.azureServiceBus.queueName);

    const message: ServiceBusMessage = {
      contentType: 'application/json',
      subject: mail.subject,
      correlationId: mail.correlationId,
      body: mail,
    };

    await sender.sendMessages(message);
    await sender.close();

    return null;
  }
  catch(err) {
    throw err;
  }
}
