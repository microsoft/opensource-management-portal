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
    advanced?: {
      resourceGroup: string;
      warmup: string;
      swapWarmup: string;
      containerName: string;
      instanceId: string;
      sku: string;
      hostname: string;
      alwaysOn: string;
      slotType: 'production' | 'staging' | undefined;
    };
  };
  baseUrl: string;
  sslify: {
    enabled: boolean;
    trustProtoHeader: boolean;
    trustAzureHeader: boolean;
  };
};
