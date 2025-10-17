//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export * from './link.js';
export * from './companySpecific/index.js';
export * from './errors.js';
export * from './operations.js';
export * from './app.js';
export * from './functions.js';
export * from './json.js';
export * from './github/index.js';
export * from './queryCache.js';
export * from './providers.js';
export * from './web.js';
export * from './config.js';

import type { ExecutionEnvironment } from './app.js';
import type {
  IAttachCompanySpecificRoutes,
  IAttachCompanySpecificMiddleware,
  ICorporationAdministrationSection,
  IAttachCompanySpecificStrings,
  ICompanySpecificFeatures,
  ICompanySpecificEvents,
  IAttachCompanySpecificViews,
  IAttachCompanySpecificUrls,
} from './companySpecific/index.js';
import type { ICompanySpecificPassportMiddleware } from './companySpecific/passport.js';
import type { SiteConfiguration } from './config.js';
import type { IProviders } from './providers.js';

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
