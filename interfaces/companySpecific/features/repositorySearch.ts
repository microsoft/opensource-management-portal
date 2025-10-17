// ISearchReposOptions

//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { IProviders } from '../../providers.js';
import type { ISearchReposOptions } from '../../../api/client/organization/repos.js';
import type { ReposAppRequest } from '../../web.js';
import { Repository } from '../../../business/index.js';

export interface ICompanySpecificFeatureRepositorySearch {
  augmentSearchOptions: (
    providers: IProviders,
    request: ReposAppRequest,
    incoming: ISearchReposOptions
  ) => Promise<ISearchReposOptions>;
  primeSearchData?: (providers: IProviders, options: ISearchReposOptions) => Promise<void>;
  searchRepos?: (
    providers: IProviders,
    options: ISearchReposOptions,
    incoming: Repository[]
  ) => Promise<Repository[]>;
}
