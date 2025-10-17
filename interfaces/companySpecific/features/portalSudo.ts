//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IPortalSudo } from '../../../business/features/index.js';
import { IProviders } from '../../../interfaces/index.js';

export interface ICompanySpecificFeaturePortalSudo {
  tryCreateInstance: (providers: IProviders) => IPortalSudo;
}
