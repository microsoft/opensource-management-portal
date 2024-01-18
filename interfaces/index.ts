//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export * from './link';
export * from './companySpecific';
export * from './errors';
export * from './operations';
export * from './app';
export * from './functions';
export * from './json';
export * from './github';
export * from './queryCache';
export * from './providers';
export * from './web';
export * from './config';

import type { ExecutionEnvironment } from './app';
import type {
  IAttachCompanySpecificRoutes,
  IAttachCompanySpecificMiddleware,
  ICorporationAdministrationSection,
  IAttachCompanySpecificStrings,
  ICompanySpecificFeatures,
  ICompanySpecificEvents,
  IAttachCompanySpecificViews,
  IAttachCompanySpecificUrls,
} from './companySpecific';
import type { ICompanySpecificPassportMiddleware } from './companySpecific/passport';
import type { SiteConfiguration } from './config';
import type { IProviders } from './providers';

// We're great at long variable names!

export interface ICompanySpecificStartupProperties {
  isCompanySpecific: true;
  events?: ICompanySpecificEvents;
  routes?: IAttachCompanySpecificRoutes;
  middleware?: IAttachCompanySpecificMiddleware;
  administrationSection?: ICorporationAdministrationSection;
  strings?: IAttachCompanySpecificStrings;
  features?: ICompanySpecificFeatures;
  passport?: ICompanySpecificPassportMiddleware;
  views?: IAttachCompanySpecificViews;
  urls?: IAttachCompanySpecificUrls;
}

export type ICompanySpecificStartupFunction = (
  executionEnvironment: ExecutionEnvironment,
  config: SiteConfiguration,
  p: IProviders,
  rootdir: string
) => Promise<void>;

export type ICompanySpecificStartup = ICompanySpecificStartupFunction & ICompanySpecificStartupProperties;
