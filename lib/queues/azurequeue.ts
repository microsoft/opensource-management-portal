//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { QueueServiceClient, QueueClient, DequeuedMessageItem } from '@azure/storage-queue';

import { tryGetEntraApplicationTokenCredential } from '../applicationIdentity.js';
import type { Json, IDictionary, IProviders } from '../../interfaces/index.js';
import type { IQueueMessage, IQueueProcessor } from './index.js';

export interface IAzureQueuesProcessorOptions {
  account: string;
  queue: string;
  sas?: string;
  useEntraAuthentication: boolean;
}

export class AzureQueuesMessage implements IQueueMessage {
  constructor(message: DequeuedMessageItem) {
    this.popReceipt = message.popReceipt;
    this.identifier = message.messageId;
    try {
      try {
        this.unparsedBody = message.messageText;
        JSON.parse(this.unparsedBody);
      } catch (jsonParseError) {
        this.unparsedBody = Buffer.from(message.messageText, 'base64').toString('utf8');
      }
      const parsed = JSON.parse(this.unparsedBody);
      if (parsed && parsed.body && typeof (parsed.body === 'string')) {
        // our own envelope format designed to work well with Azure Logic Apps
        this.unparsedBody = parsed.body;
        delete parsed.body;
        this.customProperties = parsed;
        this.body = JSON.parse(this.unparsedBody);
        this.wasEnveloped = true;
      } else {
        this.body = parsed;
        this.customProperties = {};
        this.wasEnveloped = false;
      }
    } catch (error) {
      console.warn(`Error parsing message ${this.identifier} body: ${error}`);
    }
  }

  body: Json;
  unparsedBody: string;
  identifier: string;
  customProperties: IDictionary<string>;
  popReceipt: string;
  wasEnveloped: boolean;
}

export default class AzureQueuesProcessor implements IQueueProcessor {
  queueClient: QueueClient = null;
  initialized: boolean;

  supportsMultipleThreads: true;

  constructor(
    private providers: IProviders,
    private options: IAzureQueuesProcessorOptions
  ) {
    if (!options.account) {
      throw new Error('options.account required');
    }
    if (!options.sas && !options.useEntraAuthentication) {
      throw new Error('options.sas required');
    }
    if (!options.queue) {
      throw new Error('options.queue required');
    }
  }

  getDirectClient() {
    return this.queueClient;
  }

  async initialize(): Promise<void> {
    const { account, sas, queue, useEntraAuthentication } = this.options;
    const tokenCredential = tryGetEntraApplicationTokenCredential(this.providers, `queue:${account}`);
    if (!tokenCredential && useEntraAuthentication && !sas) {
      throw new Error('Entra authentication is required but not available.');
    }
    const client = sas
      ? new QueueServiceClient(`https://${account}.queue.core.windows.net${sas}`)
      : new QueueServiceClient(`https://${account}.queue.core.windows.net`, tokenCredential);
    this.queueClient = client.getQueueClient(queue);
    this.initialized = true;
  }

  async receiveMessages(): Promise<AzureQueuesMessage[]> {
    this.requireInitialized();
    const response = await this.queueClient.receiveMessages();
    if (response.receivedMessageItems.length > 0) {
      return response.receivedMessageItems
        .map((message) => new AzureQueuesMessage(message))
        .filter((m) => m.body);
    }
    return [];
  }

  async deleteMessage(message: IQueueMessage): Promise<void> {
    this.requireInitialized();
    const assumedType = message as AzureQueuesMessage;
    if (!assumedType.popReceipt) {
      throw new Error('Message must be of type AzureQueuesMessage and have a property popReceipt.');
    }
    const deleteMessageResponse = await this.queueClient.deleteMessage(
      assumedType.identifier,
      assumedType.popReceipt
    );
    // console.log(deleteMessageResponse);
  }

  private requireInitialized() {
    if (!this.initialized) {
      throw new Error('Client must be initialized before use.');
    }
  }
}
