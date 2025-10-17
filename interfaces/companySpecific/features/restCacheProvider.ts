//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ICacheHelper } from '../../../lib/caching/index.js';
import type { SiteConfiguration } from '../../config.js';
import type { IProviders } from '../../providers.js';

export interface ICompanySpecificFeatureRestCacheProvider {
  tryCreateInstance: (providers: IProviders, config: SiteConfiguration) => Promise<ICacheHelper>;
}
