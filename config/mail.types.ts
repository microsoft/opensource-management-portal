//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootMail = {
  mail: ConfigMail;
};

export type ConfigMail = {
  provider: string;
  from: string;

  debug: {
    overrideRecipient: string;
    isProductionRun: boolean;
    testTargetCorporateId: string;
  };

  customService: {
    url: string;
    apiKey: string;
    version: string;
  };

  smtpMailService: {
    host: string;
    port: string;
    auth: {
      user: string;
      pass: string;
    };
  };

  directoryMailService: {
    clientId: string;
    clientSecret: string;
    authority: string;
    resource: string;
    publisherName: string;
    eventName: string;
    senderProfile: string;
    replyTo: string;
    appName: string;
  };
};
