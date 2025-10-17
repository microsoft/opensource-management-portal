//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Router } from 'express';

import type { IAttachCompanySpecificRoutesApi } from './api/index.js';
import type { SiteConfiguration } from '../../config.js';

export * from './api/index.js';

export type ConnectRouter = (router: Router) => void;

export interface IAttachCompanySpecificRoutes {
  connectAuthenticatedRoutes?: (router: Router, reactRoute: any) => void;
  connectHealthRoutes?: (router: Router, config: SiteConfiguration) => number;
  api?: IAttachCompanySpecificRoutesApi;
}
