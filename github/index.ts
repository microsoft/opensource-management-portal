//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

export enum AppPurpose {
  Data = 'Data',
  CustomerFacing = 'CustomerFacing',
  Operations = 'Operations',
  BackgroundJobs = 'BackgroundJobs', // "secondary" / "default" fallback
}

export enum GitHubAppAuthenticationType {
  ForceSpecificInstallation,
  BestAvailable,
}

export interface IGitHubAppConfiguration {
  clientId?: string;
  clientSecret?: string;
  appId?: number;
  appKey?: string;
  appKeyFile?: string;
  webhookSecret?: string;
  slug?: string;
  description?: string;
}

export interface IGitHubAppsOptions {
  backgroundJobs?: IGitHubAppConfiguration;
  dataApp?: IGitHubAppConfiguration;
  customerFacingApp?: IGitHubAppConfiguration;
  operationsApp?: IGitHubAppConfiguration;
}
