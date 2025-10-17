//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { GitHubAppConfiguration } from '../../../lib/github/appPurposes.js';
import type { IProviders } from '../../../interfaces/index.js';
import type { UnlinkOptions } from '../../../business/operations/core.js';

export interface ICompanySpecificFeatureEnterprises {
  getEnterpriseConfigurations?: (providers: IProviders) => GitHubAppConfiguration[];
  onUnlink?: (
    providers: IProviders,
    gitHubAccountId: number,
    options?: UnlinkOptions,
    unlinkLog?: string[]
  ) => Promise<void>;
}
