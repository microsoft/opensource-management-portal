//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository, Team } from '../../business';
import { IContextualRepositoryPermissions } from '../../middleware/github/repoPermissions';
import { IProviders, ReposAppRequest } from '../../interfaces';
import { IndividualContext } from '../../business/user';
import { IRequestTeamPermissions } from '../../middleware/github/teamPermissions';
import type { ApiClientGroupDisplay } from '../api';
import { ITeamJoinRequestSubmitOutcome } from '../../routes/org/team';

export interface ICompanySpecificRepoPermissionsMiddlewareCalls {
  afterPermissionsInitialized?: (
    providers: IProviders,
    permissions: IContextualRepositoryPermissions,
    activeContext: IndividualContext
  ) => void;
  afterPermissionsComputed?: (
    providers: IProviders,
    permissions: IContextualRepositoryPermissions,
    activeContext: IndividualContext,
    repository: Repository
  ) => Promise<void>;
}

export interface ICompanySpecificTeamPermissionsMiddlewareCalls {
  afterPermissionsInitialized?: (
    providers: IProviders,
    permissions: IRequestTeamPermissions,
    activeContext: IndividualContext
  ) => void;
  afterPermissionsComputed?: (
    providers: IProviders,
    permissions: IRequestTeamPermissions,
    activeContext: IndividualContext,
    team: Team
  ) => Promise<void>;
  beforeJoinRequest?: (
    providers: IProviders,
    activeContext: IndividualContext,
    team: Team
  ) => Promise<ITeamJoinRequestSubmitOutcome | void>;
}

export interface ICompanySpecificAuthenticationCalls {
  shouldRedirectToSignIn?: (providers: IProviders, req: ReposAppRequest) => Promise<boolean>;
  getAadApiAuthenticationValidator?(providers: IProviders): IAadAuthenticationValidator;
}

export interface IAadAuthenticationValidator {
  isAuthorizedTenant(tenantId: string): Promise<boolean>;
  getAudienceIdentities(): Promise<string[]>;
  getAuthorizedClientIdToken(clientId: string): Promise<unknown>;
  getAuthorizedObjectIdToken(objectId: string): Promise<unknown>;
  getScopes(tokenRepresentation: any): Promise<string[]>;
  getDisplayValues(tokenRepresentation: any): Promise<ApiClientGroupDisplay>;
}

export interface IAttachCompanySpecificMiddleware {
  repoPermissions?: ICompanySpecificRepoPermissionsMiddlewareCalls;
  teamPermissions?: ICompanySpecificTeamPermissionsMiddlewareCalls;
  authentication: ICompanySpecificAuthenticationCalls;
}
