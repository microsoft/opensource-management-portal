//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Organization } from '../../../business/index.js';
import { IProviders } from '../../../interfaces/index.js';
import { IndividualContext } from '../../../business/user/index.js';

export interface ICompanySpecificFeatureOrganizationJoinAcl {
  tryAuthorizeOrganizationJoin: (
    providers: IProviders,
    organization: Organization,
    activeContext: IndividualContext
  ) => Promise<boolean>;
}
