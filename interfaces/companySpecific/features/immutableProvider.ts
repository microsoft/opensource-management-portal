//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { IImmutableStorageProvider } from '../../../lib/immutable.js';
import type { SiteConfiguration } from '../../config.js';
import type { IProviders } from '../../providers.js';

export interface ICompanySpecificFeatureImmutableProvider {
  tryCreateInstance: (providers: IProviders, config: SiteConfiguration) => IImmutableStorageProvider;
}
