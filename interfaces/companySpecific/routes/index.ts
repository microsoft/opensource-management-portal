//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import { IAttachCompanySpecificRoutesApi } from './api';

export * from './api';

export type ConnectRouter = (router: Router) => void;

export interface IAttachCompanySpecificRoutes {
  connectAuthenticatedRoutes: (router: Router, reactRoute: any) => void;
  api?: IAttachCompanySpecificRoutesApi;
}
