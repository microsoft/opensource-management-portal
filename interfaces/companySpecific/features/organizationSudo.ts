//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Organization } from '../../../business/index.js';
import { IOrganizationSudo } from '../../../business/features/index.js';
import { IProviders } from '../../../interfaces/index.js';

export interface ICompanySpecificFeatureOrganizationSudo {
  tryCreateInstance: (providers: IProviders, organization: Organization) => IOrganizationSudo;
}
