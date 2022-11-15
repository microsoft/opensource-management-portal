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

  constructor(mailConfig: any) {
    this._config = mailConfig;
  }

  getSentMessages() {
    return []; // this provider does not support mocks
  }

  async initialize() { }

  async sendMail(mail: IMail): Promise<any> {
    if (!this._config.azureServiceBus) {
      throw new Error('Azure Service bus configuration not provided, mail sending failed');
    }

    if (!mail.to) {
      throw new Error('No email recipient provided');
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