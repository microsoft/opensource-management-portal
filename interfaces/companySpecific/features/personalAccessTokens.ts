//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { IProviders } from '../../../interfaces/index.js';

export type CommitterAccessToken = {
  token: string;
  login: string;
};

export interface ICompanySpecificFeaturePersonalAccessTokens {
  getPublicReadToken?: (providers: IProviders) => Promise<string | undefined>;
  tryGetCommitterToken?: (providers: IProviders) => Promise<CommitterAccessToken | undefined>;
}
