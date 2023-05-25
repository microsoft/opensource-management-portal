//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Organization } from '../../../business';
import { IProviders } from '../../../interfaces';
import { IndividualContext } from '../../../business/user';

export interface ICompanySpecificFeatureOrganizationJoinAcl {
  tryAuthorizeOrganizationJoin: (
    providers: IProviders,
    organization: Organization,
    activeContext: IndividualContext
  ) => Promise<boolean>;
}
