//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ICompanySpecificAugmentApiMetadata } from './augmentApiMetadata';
import { ICompanySpecificFeatureDemo } from './demo';
import { ICompanySpecificFeatureFirehose } from './firehose';
import { ICompanySpecificFeatureMailProvider } from './mailProvider';
import { ICompanySpecificFeatureOrganizationJoinAcl } from './organizationJoinAcl';
import { ICompanySpecificFeatureOrganizationSudo } from './organizationSudo';
import { ICompanySpecificFeaturePortalSudo } from './portalSudo';
import { ICompanySpecificFeatureRepositoryState } from './repositoryActions';

export * from './organizationSudo';
export * from './portalSudo';
export * from './demo';
export * from './repositoryActions';
export * from './firehose';
export * from './mailProvider';
export * from './organizationJoinAcl';
export * from './augmentApiMetadata';

export interface ICompanySpecificFeatures {
  augmentApiMetadata: ICompanySpecificAugmentApiMetadata;
  organizationSudo?: ICompanySpecificFeatureOrganizationSudo;
  organizationJoinAcl?: ICompanySpecificFeatureOrganizationJoinAcl;
  portalSudo?: ICompanySpecificFeaturePortalSudo;
  demo?: ICompanySpecificFeatureDemo;
  repositoryActions?: ICompanySpecificFeatureRepositoryState;
  firehose?: ICompanySpecificFeatureFirehose;
  mailProvider?: ICompanySpecificFeatureMailProvider;
}
