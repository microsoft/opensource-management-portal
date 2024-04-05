//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ICompanySpecificAugmentApiMetadata } from './augmentApiMetadata';
import type { ICompanySpecificFeatureDemo } from './demo';
import type { ICompanySpecificFeatureFirehose } from './firehose';
import type { ICompanySpecificFeatureMailProvider } from './mailProvider';
import type { ICompanySpecificFeatureOrganizationJoinAcl } from './organizationJoinAcl';
import type { ICompanySpecificFeatureOrganizationSudo } from './organizationSudo';
import type { ICompanySpecificFeaturePortalSudo } from './portalSudo';
import type { ICompanySpecificFeatureRepositoryState } from './repositoryActions';

export * from './organizationSudo';
export * from './portalSudo';
export * from './demo';
export * from './repositoryActions';
export * from './firehose';
export * from './mailProvider';
export * from './organizationJoinAcl';
export * from './augmentApiMetadata';

export interface ICompanySpecificFeatures {
  augmentApiMetadata?: ICompanySpecificAugmentApiMetadata;
  organizationSudo?: ICompanySpecificFeatureOrganizationSudo;
  organizationJoinAcl?: ICompanySpecificFeatureOrganizationJoinAcl;
  portalSudo?: ICompanySpecificFeaturePortalSudo;
  demo?: ICompanySpecificFeatureDemo;
  repositoryActions?: ICompanySpecificFeatureRepositoryState;
  firehose?: ICompanySpecificFeatureFirehose;
  mailProvider?: ICompanySpecificFeatureMailProvider;
}
