//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ICompanySpecificFeatureDemo } from './demo';
import { ICompanySpecificFeatureOrganizationSudo } from './organizationSudo';
import { ICompanySpecificFeaturePortalSudo } from './portalSudo';
import { ICompanySpecificFeatureRepositoryState } from './repositoryActions';

export * from './organizationSudo';
export * from './portalSudo';
export * from './demo';
export * from './repositoryActions';

export interface ICompanySpecificFeatures {
  organizationSudo?: ICompanySpecificFeatureOrganizationSudo;
  portalSudo?: ICompanySpecificFeaturePortalSudo;
  demo?: ICompanySpecificFeatureDemo;
  repositoryActions?: ICompanySpecificFeatureRepositoryState;
}
