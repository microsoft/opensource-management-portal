//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { PassportStatic } from 'passport';

export interface ICompanySpecificPassportMiddleware {
  configure?: (app: any, config: any, passport: PassportStatic) => void;
  attach?: (app: any, config: any, passport: PassportStatic) => void;
}
