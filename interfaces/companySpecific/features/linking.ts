//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { IProviders } from '../../../interfaces/index.js';
import type { IndividualContext } from '../../../business/user/index.js';

export interface ICompanySpecificFeatureLinking {
  confirmLinkingAuthorized: (providers: IProviders, activeContext: IndividualContext) => Promise<void>;
}
