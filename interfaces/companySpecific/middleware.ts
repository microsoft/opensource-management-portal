//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository, Team } from '../../business';
import { IContextualRepositoryPermissions } from '../../middleware/github/repoPermissions';
import { IProviders } from '../../interfaces';
import { IndividualContext } from '../../user';
import { IRequestTeamPermissions } from '../../middleware/github/teamPermissions';

export interface ICompanySpecificRepoPermissionsMiddlewareCalls {
  afterPermissionsInitialized?: (providers: IProviders, permissions: IContextualRepositoryPermissions, activeContext: IndividualContext) => void;
  afterPermissionsComputed?: (providers: IProviders, permissions: IContextualRepositoryPermissions, activeContext: IndividualContext, repository: Repository) => Promise<void>;
}

export interface ICompanySpecificTeamPermissionsMiddlewareCalls {
  afterPermissionsInitialized?: (providers: IProviders, permissions: IRequestTeamPermissions, activeContext: IndividualContext) => void;
  afterPermissionsComputed?: (providers: IProviders, permissions: IRequestTeamPermissions, activeContext: IndividualContext, team: Team) => Promise<void>;
}

export interface IAttachCompanySpecificMiddleware {
  repoPermissions?: ICompanySpecificRepoPermissionsMiddlewareCalls;
  teamPermissions?: ICompanySpecificTeamPermissionsMiddlewareCalls;
}
