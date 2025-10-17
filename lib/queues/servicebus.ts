//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { DateTime } from 'luxon';
import { ServiceBusClient, ServiceBusReceivedMessage, ServiceBusReceiver } from '@azure/service-bus';

import type { IQueueMessage, IQueueProcessor } from './index.js';
import { IDictionary, IProviders, Json } from '../../interfaces/index.js';
import { CreateError } from '../transitional.js';
import { tryGetEntraApplicationTokenCredential } from '../applicationIdentity.js';

// NOTE: in May 2021 this file was moved to the newer generation of Azure SDK dependencies,
// which brings in AMQP under the covers instead of the HTTP REST approach; this is therefore
// an inefficient implementation since subscribe() is not being used directly yet.

const defaultMessagesPerRequest = 5; // could be configurable in the future
const maxWaitTimeInMs = 30 /* seconds */ * 1000;

export interface IServiceBusQueueProcessorOptions {
  queue: string;
  connectionString?: string;
  useEntraAuthentication?: boolean;
  endpoint?: string;
  immediatelyDeleteMessages: boolean;
  maximumMessagesPerRequest?: number;
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
  #receiver: ServiceBusReceiver;
  #initialized: boolean;

  supportsMultipleThreads: false;

  constructor(
    private providers: IProviders,
    options: IServiceBusQueueProcessorOptions
  ) {
    if (!options.connectionString && !options.useEntraAuthentication) {
      throw CreateError.InvalidParameters('options.connectionString required');
    } else if (options.useEntraAuthentication && !options.endpoint) {
      throw CreateError.InvalidParameters('options.endpoint required for Entra ID');
    }
    if (!options.queue) {
      throw CreateError.InvalidParameters('options.queue required');
    }
    this.#options = options;
  }

  async initialize(): Promise<void> {
    const options = this.#options;
    const service = this.#options.useEntraAuthentication
      ? new ServiceBusClient(
          options.endpoint,
          tryGetEntraApplicationTokenCredential(this.providers, 'service bus')
        )
      : new ServiceBusClient(options.connectionString);
    this.#receiver = service.createReceiver(options.queue, {
      receiveMode: options.immediatelyDeleteMessages ? 'receiveAndDelete' : 'peekLock',
    });
    this.#initialized = true;
  }

  async receiveMessages(maxWaitTimeMsAlternative?: number): Promise<ServiceBusMessage[]> {
    if (!this.#initialized) {
      throw new Error('Provider not initialized');
    }

    try {
      const messages = await this.#receiver.receiveMessages(
        this.#options.maximumMessagesPerRequest || defaultMessagesPerRequest,
        {
          maxWaitTimeInMs: maxWaitTimeMsAlternative || maxWaitTimeInMs,
        }
      );
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
    if (this.#options.immediatelyDeleteMessages) {
      console.log(
        `In immediate delete mode, not deleting message ${message.identifier} (it was already handled)`
      );
      return;
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
