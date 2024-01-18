//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Organization } from '../../../business';
import { IOrganizationSudo } from '../../../business/features';
import { IProviders } from '../../../interfaces';

export interface ICompanySpecificFeatureOrganizationSudo {
  tryCreateInstance: (providers: IProviders, organization: Organization) => IOrganizationSudo;
}
