//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IPortalSudo } from '../../../features';
import { IProviders } from '../../../transitional';

export interface ICompanySpecificFeaturePortalSudo {
  tryCreateInstance: (providers: IProviders) => IPortalSudo;
}
