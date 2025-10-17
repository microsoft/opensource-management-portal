//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { IQueueProcessor } from '../../../lib/queues/index.js';
import type { SiteConfiguration } from '../../config.js';
import type { IProviders } from '../../providers.js';

export interface ICompanySpecificFeatureQueuesProvider {
  tryCreateInstance: (providers: IProviders, config: SiteConfiguration) => Promise<IQueueProcessor>;
}
