//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IProviders, LocalApiRepoAction } from '../../index.js';
import { Repository } from '../../../business/index.js';
import { IndividualContext } from '../../../business/user/index.js';

export interface ICompanySpecificFeatureRepositoryState {
  getCurrentRepositoryState(providers: IProviders, repository: Repository): Promise<unknown>;
  sendActionReceipt(
    providers: IProviders,
    context: IndividualContext,
    repository: Repository,
    action: LocalApiRepoAction,
    currentState: unknown
  ): Promise<void>;
}
