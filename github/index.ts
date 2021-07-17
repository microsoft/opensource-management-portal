//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IReposApplication } from '../interfaces';

export enum AppPurpose {
  Data = 'Data',
  CustomerFacing = 'CustomerFacing',
  Operations = 'Operations',
  BackgroundJobs = 'BackgroundJobs', // "secondary" / "default" fallback
  Updates = 'Updates',
  Security = 'Security',
  ActionsData = 'ActionsData',
}

export const AllAvailableAppPurposes = [
  AppPurpose.Data,
  AppPurpose.CustomerFacing,
  AppPurpose.Operations,
  AppPurpose.BackgroundJobs,
  AppPurpose.Updates,
  AppPurpose.Security,
  AppPurpose.ActionsData,
];

export const AppPurposeToConfigurationName = {
  [AppPurpose.Data]: 'data',
  [AppPurpose.CustomerFacing]: 'ui',
  [AppPurpose.Operations]: 'operations',
  [AppPurpose.BackgroundJobs]: 'jobs',
  [AppPurpose.Updates]: 'updates',
  [AppPurpose.Security]: 'security',
  [AppPurpose.ActionsData]: 'actions',
}

export enum GitHubAppAuthenticationType {
  ForceSpecificInstallation = 'force',
  BestAvailable = 'best',
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
  baseUrl: string;
}

export interface IGitHubAppsOptions {
  app: IReposApplication;
  configurations: Map<AppPurpose, IGitHubAppConfiguration>;
}
