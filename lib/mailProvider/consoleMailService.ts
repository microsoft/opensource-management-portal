//
// Copyright (c) Microsoft.
//

import type { SiteConfiguration } from '../../config/index.types.js';
import type { AppInsightsTelemetryClient } from '../../interfaces/providers.js';
import type { IMail, IMailProvider } from './index.js';

export default class ConsoleMailService implements IMailProvider {
  html: true;
  appVersion: any;

  constructor(config: SiteConfiguration) {
    this.appVersion = config.logging.version;
  }

  async initialize() {}

  get info(): string {
    return `console`;
  }

  async sendMail(insights: AppInsightsTelemetryClient, mail: IMail): Promise<any> {
    console.log(`Sending mail to ${mail.to}: ${mail.subject}`);
    console.log(mail.content);
    console.log();
  }

  getSentMessages() {
    return [];
  }
}
