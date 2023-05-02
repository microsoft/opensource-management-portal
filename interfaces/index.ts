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

import {
  IAttachCompanySpecificRoutes,
  IAttachCompanySpecificMiddleware,
  ICorporationAdministrationSection,
  IAttachCompanySpecificStrings,
  ICompanySpecificFeatures,
  IAttachCompanySpecificViews,
  IAttachCompanySpecificUrls,
} from './companySpecific';
import { ICompanySpecificPassportMiddleware } from './companySpecific/passport';
import { IProviders } from './providers';

// We're great at long variable names!

export interface ICompanySpecificStartupProperties {
  isCompanySpecific: true;
  routes?: IAttachCompanySpecificRoutes;
  middleware?: IAttachCompanySpecificMiddleware;
  administrationSection?: ICorporationAdministrationSection;
  strings?: IAttachCompanySpecificStrings;
  features?: ICompanySpecificFeatures;
  passport?: ICompanySpecificPassportMiddleware;
  views?: IAttachCompanySpecificViews;
  urls?: IAttachCompanySpecificUrls;
}

export type ICompanySpecificStartupFunction = (config: any, p: IProviders, rootdir: string) => Promise<void>;

export type ICompanySpecificStartup = ICompanySpecificStartupFunction & ICompanySpecificStartupProperties;
