//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootWebServer = {
  webServer: ConfigWebServer;
};

export type ConfigWebServer = {
  port: number;
  allowHttp: boolean;
  appService: {
    slot: string;
    name: string;
    region: string;
  };
  baseUrl: string;
  sslify: {
    enabled: boolean;
    trustProtoHeader: boolean;
    trustAzureHeader: boolean;
  };
};
