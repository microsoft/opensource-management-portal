//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { DateTime } from 'luxon';
import { ServiceBusClient, ServiceBusReceivedMessage, ServiceBusReceiver } from '@azure/service-bus';

import { IQueueMessage, IQueueProcessor } from '.';
import { IDictionary, Json } from '../../interfaces';

// NOTE: in May 2021 this file was moved to the newer generation of Azure SDK dependencies,
// which brings in AMQP under the covers instead of the HTTP REST approach; this is therefore
// an inefficient implementation since subscribe() is not being used directly yet.

const defaultMessagesPerRequest = 5; // could be configurable in the future
const maxWaitTimeInMs = 30 /* seconds */ * 1000;

export interface IServiceBusQueueProcessorOptions {
  queue: string;
  connectionString: string;
}

export class ServiceBusMessage implements IQueueMessage {
  #lockedMessage: ServiceBusReceivedMessage = null;
  constructor(message: ServiceBusReceivedMessage) {
    this.#lockedMessage = message;
    this.brokerProperties = Object.assign({}, message) as unknown as IDictionary<string>;
    if (message.enqueuedTimeUtc) {
      this.enqueuedSecondsAgo = DateTime.fromJSDate(message.enqueuedTimeUtc).diffNow().seconds;
    }
    // let deliveryCount = message.brokerProperties[DeliveryCount] !== undefined ? message.brokerProperties[DeliveryCount] : null;
    this.identifier =
      message.messageId && typeof message.messageId === 'string' ? message.messageId : undefined;
    this.customProperties = message.applicationProperties as IDictionary<string>;
    this.unparsedBody = message.body;
    this.body = typeof message.body === 'string' ? JSON.parse(message.body) : this.unparsedBody; // newer library parses JSON automatically
  }

  body: Json;
  customProperties: IDictionary<string>;
  brokerProperties: IDictionary<string>;
  unparsedBody: any;

  identifier: string;
  enqueuedSecondsAgo?: number;

  lockedMessage() {
    return this.#lockedMessage;
  }
}

export default class ServiceBusQueueProcessor implements IQueueProcessor {
  #options: IServiceBusQueueProcessorOptions;
  #service: ServiceBusClient;
  #receiver: ServiceBusReceiver;
  #initialized: boolean;

  supportsMultipleThreads: false;

  constructor(options: IServiceBusQueueProcessorOptions) {
    if (!options.connectionString) {
      throw new Error('options.connectionString required');
    }
    if (!options.queue) {
      throw new Error('options.queue required');
    }
    this.#options = options;
  }

  async initialize(): Promise<void> {
    const options = this.#options;
    const service = new ServiceBusClient(options.connectionString);
    this.#service = service;
    this.#receiver = service.createReceiver(options.queue, { receiveMode: 'peekLock' });
    this.#initialized = true;
  }

  async receiveMessages(): Promise<ServiceBusMessage[]> {
    if (!this.#initialized) {
      throw new Error('Provider not initialized');
    }

    try {
      const messages = await this.#receiver.receiveMessages(defaultMessagesPerRequest, {
        maxWaitTimeInMs,
      });
      return messages.map((message) => new ServiceBusMessage(message));
    } catch (error) {
      // if empty, return empty array

      console.warn(error);
    }
  }

  async deleteMessage(message: IQueueMessage): Promise<void> {
    if (!this.#initialized) {
      throw new Error('Provider not initialized');
    }
    const assumedType = message as ServiceBusMessage;
    const lockedMessage = assumedType.lockedMessage();
    try {
      await this.#receiver.completeMessage(lockedMessage);
    } catch (deleteError) {
      console.warn(`Delete error: ${deleteError}`);
      throw deleteError;
    }
  }
}
