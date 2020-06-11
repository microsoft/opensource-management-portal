//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IProviders } from '../transitional';
import { Repository } from '../business/repository';

// TODO: refresh occassionally.

export default class PublicReposFastFilter {
  #providers: IProviders;
  #initialized: boolean;

  repositories: Repository[];

  get isInitialized() {
    return this.#initialized;
  }

  constructor(providers: IProviders) {
    this.#providers = providers;
  }

  async initialize() {
    if (!this.#providers.queryCache) {
      throw new Error('Query cache provider must be available');
    }
    if (!this.#providers.queryCache.supportsRepositories) {
      throw new Error('Query cache of repositories must be available');
    }
    const { queryCache } = this.#providers;
    const repositories = (await queryCache.allRepositories()).filter(repo => !repo.repository.private);
    this.repositories = repositories.map(entry => entry.repository);

    this.#initialized = true;
  }
}
