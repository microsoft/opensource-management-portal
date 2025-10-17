//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { EntraApplicationIdentity, IProviders } from '../../../interfaces/index.js';
import type { EntraApplication } from '../../../lib/applicationIdentity.js';

export interface ICompanySpecificAugmentIdentity {
  createEntraApplicationInstance?: (providers: IProviders, destinationResource: string) => EntraApplication;
  tryGetEntraApplicationIdentity?: (providers: IProviders, resource: string) => EntraApplicationIdentity;
}
