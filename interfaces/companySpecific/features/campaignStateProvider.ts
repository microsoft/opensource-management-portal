//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ICampaignHelper } from '../../../lib/campaignState/campaigns.js';
import type { SiteConfiguration } from '../../config.js';
import type { IProviders } from '../../providers.js';

export interface ICompanySpecificFeatureCampaignStateProvider {
  tryCreateInstance: (providers: IProviders, config: SiteConfiguration) => Promise<ICampaignHelper>;
}
