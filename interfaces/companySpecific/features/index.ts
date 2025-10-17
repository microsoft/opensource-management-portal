//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ICompanySpecificAugmentApiMetadata } from './augmentApiMetadata.js';
import type { ICompanySpecificFeatureDemo } from './demo.js';
import type { ICompanySpecificFeatureEnterprises } from './enterprises.js';
import type { ICompanySpecificFeatureFirehose } from './firehose.js';
import type { ICompanySpecificFeatureLinking } from './linking.js';
import type { ICompanySpecificFeatureMailProvider } from './mailProvider.js';
import type { ICompanySpecificFeatureOrganizationJoinAcl } from './organizationJoinAcl.js';
import type { ICompanySpecificFeatureOrganizationSudo } from './organizationSudo.js';
import type { ICompanySpecificFeaturePortalSudo } from './portalSudo.js';
import type { ICompanySpecificFeatureRepositoryState } from './repositoryActions.js';
import type { ICompanySpecificFeatureImmutableProvider } from './immutableProvider.js';
import type { ICompanySpecificAugmentIdentity } from './identity.js';
import type { ICompanySpecificFeatureCampaignStateProvider } from './campaignStateProvider.js';
import type { ICompanySpecificFeatureRestCacheProvider } from './restCacheProvider.js';
import type { ICompanySpecificFeatureRepositorySearch } from '../index.js';
import type { ICompanySpecificFeatureQueuesProvider } from './queuesProvider.js';

export * from './augmentApiMetadata.js';
export * from './campaignStateProvider.js';
export * from './demo.js';
export * from './enterprises.js';
export * from './identity.js';
export * from './immutableProvider.js';
export * from './firehose.js';
export * from './linking.js';
export * from './mailProvider.js';
export * from './organizationJoinAcl.js';
export * from './organizationSudo.js';
export * from './portalSudo.js';
export * from './repositoryActions.js';
export * from './repositorySearch.js';
export * from './restCacheProvider.js';
export * from './queuesProvider.js';

export interface ICompanySpecificFeatures {
  augmentApiMetadata?: ICompanySpecificAugmentApiMetadata;
  campaignStateProvider?: ICompanySpecificFeatureCampaignStateProvider;
  demo?: ICompanySpecificFeatureDemo;
  enterprises?: ICompanySpecificFeatureEnterprises;
  firehose?: ICompanySpecificFeatureFirehose;
  identity?: ICompanySpecificAugmentIdentity;
  immutableProvider?: ICompanySpecificFeatureImmutableProvider;
  linking?: ICompanySpecificFeatureLinking;
  mailProvider?: ICompanySpecificFeatureMailProvider;
  organizationSudo?: ICompanySpecificFeatureOrganizationSudo;
  organizationJoinAcl?: ICompanySpecificFeatureOrganizationJoinAcl;
  portalSudo?: ICompanySpecificFeaturePortalSudo;
  repositoryActions?: ICompanySpecificFeatureRepositoryState;
  repositorySearch?: ICompanySpecificFeatureRepositorySearch;
  restCache?: ICompanySpecificFeatureRestCacheProvider;
  queues?: ICompanySpecificFeatureQueuesProvider;
}
