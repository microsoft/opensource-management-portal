//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { IDictionary } from '../../interfaces/index.js';

export interface ICorporationAdministrationSection {
  urls: IDictionary<string>;
  setupRoutes?: (router: Router) => void;
}
