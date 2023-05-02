//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Organization } from '../../../business';
import { IProviders } from '../../../interfaces';

export interface ICompanySpecificAugmentApiMetadata {
  augmentOrganizationClientJson: (
    providers: IProviders,
    organization: Organization,
    standardJsonMetadata: any
  ) => any;
}
