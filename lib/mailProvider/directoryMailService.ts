//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// This file uses a Microsoft-specific internal mail system that will not be very useful to others.

import * as adalNode from 'adal-node';
import { v4 } from 'uuid';

import appPackage = require('../../package.json');

const request = require('requestretry').defaults({ json: true, maxAttempts: 3, fullResponse: true });

import { IMailProvider, IMail } from '.';
import { IDictionary } from '../../transitional';

function pop(obj, key) {
  const val = obj[key];
  delete obj[key];
  return val;
}

const directoryClientVersion = '1.0.0';

export interface IDirectoryMailServiceOptions {
  appName: string;
  clientId: string;
  clientSecret: string;
  authority: string;
  resource: string;
  publisherName: string;
  eventName: string;
  senderProfile: string;
  replyTo?: string;
}

const requiredProperties = [
  'appName',
  'clientId',
  'clientSecret',
  'authority',
  'resource',
  'publisherName',
  'eventName',
  'senderProfile',
  // replyTo: optional
];

const uninterestingHeaders = [
  'connection',
  'date',
  'content-length',
  'client-request-id',
];

interface IDirectoryMailResult {
  requestId: string;
  headers: IDictionary<string>;
}

export default class DirectoryMailService implements IMailProvider {
  private static readonly maxTokenAge: number = 1000 * 10; // 10 seconds
  private directoryTokenLastSet: number;
  private directoryToken: string;

  #options: IDirectoryMailServiceOptions;

  html: true;
  info: string;

  getSentMessages() {
    return []; // this provider does not support in-project testing
  }

  constructor(directoryMailOptions: IDirectoryMailServiceOptions) {
    for (const property of requiredProperties) {
      if (!directoryMailOptions[property]) {
        throw new Error(`directoryMailOptions.${property} is required`);
      }
    };
    this.#options = directoryMailOptions;
    const { version } = appPackage;
    this.info = `${directoryMailOptions.appName}-${directoryClientVersion} v${version}`;
  }

  async initialize() {
    const pingEvent = new DirectoryMailServiceMessage('Ping');
    const { headers } = await this.sendToService(pingEvent);
    const headerNames = Object.getOwnPropertyNames(headers).filter(name => !uninterestingHeaders.includes(name));
    return headerNames.map(name => `${name}=${headers[name]}`).join(' ');
  }

  async sendMail(mail: IMail): Promise<any> {
    let replyTo: string | string[] = this.#options.replyTo;
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
    if (replyTo && typeof replyTo === 'string') {
      replyTo = [ replyTo ];
    }
    const correlationId = pop(mail, 'correlationId');
    cc = cc || [];
    bcc = bcc || [];
    const html = content;
    const text = null;
    const message = new DirectoryMailServiceMessage(this.#options.eventName);
    message.SenderProfile = this.#options.senderProfile;
    const source = html ? {
      KeyValuePairs: {
        Subject: subject,
        HtmlBody: html,
      },
      SourceType: 'Inline',
    } : {
      KeyValuePairs: {
        Subject: subject,
        PlainTextBody: text,
      },
      SourceType: 'Inline',
    };
    message.Configuration = {
      Deliveries: [{
        DeliveryType: 'Email',
        Engine: { EngineType: 'PassThrough' },
        Source: source,
        TopicId: null,
        Validity: null
      }],
      RealTime: false,
      CampaignInjectionId: null,
      SkipProfile: true,
    };
    message.Recipients = {
      To: this.mapRecipientToSpecializedFormat(to),
      Cc: this.mapRecipientToSpecializedFormat(cc),
      Bcc: this.mapRecipientToSpecializedFormat(bcc),
      ReplyTo: this.mapRecipientToSpecializedFormat(replyTo as string[]),
    };

    try {
      const receipt = await this.sendToService(message);
      return receipt.requestId;
    } catch (sendError) {
      console.dir(sendError);
      throw sendError;
    }
  }

  private async sendToService(body: DirectoryMailServiceMessage): Promise<IDirectoryMailResult> {
    const requestId = v4();
    try {
      const token = await this.getDirectoryToken();
      const publisherName = this.#options.publisherName;
      const authHeaderValue = `Partner partner_id="${publisherName}", bearer_token="${token}"`;
      const url = `${this.#options.resource}events/v1/trigger`;
      const options = {
        url,
        headers: {
          'Content-Type': 'application/vnd.ms.services.mucp.event.v1+json; charset=utf-8',
          'client-request-id': requestId,
          'return-client-request-id': 'True',
          'User-Agent': this.info,
          'Authorization': authHeaderValue,
        },
        body,
      };
      return await new Promise((resolve, reject) => {
        return request.post(options, (err: Error, response: any, responseBody: any) => {
          if (!err && response) {
            if (response.statusCode === 401) {
              err = new Error(`Not authorized to connect to the directory mail service with publisherName=${publisherName}, clientId=${this.#options.clientId}`);
            } else if (response.statusCode !== 202) {
              err = new Error(`statusCode=${response.statusCode} returned trying to send to the directory mail service with clientId=${this.#options.clientId}`);
            }
          }
          if (err) {
            err['client-request-id'] = requestId;
            return reject(err);
          }
          return resolve({ headers: response.headers, requestId });
        });
      });
    } catch (error) {
      error['client-request-id'] = requestId;
      throw error;
    }
  }

  private getDirectoryToken(): Promise<string> {
    const now = (new Date()).getTime();
    const tokenTime = this.directoryTokenLastSet || 0;
    const allowedMax = tokenTime + DirectoryMailService.maxTokenAge;
    return new Promise((resolve, reject) => {
      if (this.directoryToken && now <= allowedMax) {
        return resolve(this.directoryToken);
      }
      const context = new adalNode.AuthenticationContext(this.#options.authority);
      context.acquireTokenWithClientCredentials(this.#options.resource, this.#options.clientId, this.#options.clientSecret, (tokenAcquisitionError, tokenResponse) => {
        if (tokenAcquisitionError) {
          return reject(tokenAcquisitionError);
        }
        const authorizationValue = (tokenResponse as adalNode.TokenResponse).accessToken;
        this.directoryToken = authorizationValue;
        this.directoryTokenLastSet = now;
        return resolve(authorizationValue);
      });
    });
  }

  private mapRecipientToSpecializedFormat(recipients: string[]) {
    if (recipients && Array.isArray(recipients) && recipients.length > 0) {
      return recipients.filter(email => email).map(rec => {
        return {
          Format: 1, // hard-coded C#/.NET enum from a specific SDK
          Value: rec,
        };
      });
    } else {
      return null;
    }
  }
}

class DirectoryMailServiceMessage {
  public EventName: string;
  public InstanceId: string;
  public Recipients: any = null;
  public Attachments: any = null;
  public LinkedAttachments: any = null;
  public Puid: string = null;
  public Locale: string = null;
  public Properties: any = null;
  public Date: string = null;
  public Targeting: string = null;
  public Configuration: any = null;
  public Delay: any = null;
  public SenderProfile: any = null;
  public NotAfter: any = null;
  public CommercialIdentity: any = null;

  constructor(eventName: string) {
    this.InstanceId = v4();
    this.EventName = eventName;
  }

  getInstrumentationDetails(): any {
    return {
      eventName: this.EventName,
      instanceId: this.InstanceId
    };
  }
}
