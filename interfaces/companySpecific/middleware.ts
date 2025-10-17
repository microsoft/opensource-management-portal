//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { Request } from 'express';
import type { AuthenticationResult } from '@azure/msal-node';

import type { Repository, Team } from '../../business/index.js';
import type { EntraApiTokenValidationFunction } from '../../middleware/api/authentication/types.js';
import type { IContextualRepositoryPermissions } from '../../middleware/github/repoPermissions.js';
import type { IProviders, ReposAppRequest } from '../../interfaces/index.js';
import type { IndividualContext } from '../../business/user/index.js';
import type { IRequestTeamPermissions } from '../../middleware/github/teamPermissions.js';
import type { ITeamJoinRequestSubmitOutcome } from '../../routes/org/team/index.js';
import type { ApiClientGroupDisplay } from '../api.js';

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
  getEntraApiAuthorizationValidator?(providers: IProviders): IEntraAuthorizationProperties;
  getEntraApiTokenValidator?(providers: IProviders): EntraApiTokenValidationFunction;
  validateWebAuthenticationBearerToken?(
    providers: IProviders,
    request: Request,
    authenticationResponse: AuthenticationResult,
    bearerToken: string
  ): Promise<void>;
  augmentEmuBlock?: (providers: IProviders, err: Error) => Promise<Error>;
}

export interface IEntraAuthorizationProperties {
  isAuthorizedTenant(tenantId: string): Promise<boolean>;
  getAudienceIdentities(): Promise<string[]>;
  getAuthorizedClientIdToken(clientId: string): Promise<unknown>;
  getAuthorizedObjectIdToken(objectId: string): Promise<unknown>;
  getAuthorizedClientAndObjectIdTokenPairs(
    tenantId: string,
    clientId: string,
    objectId: string
  ): Promise<{ pairs: string[]; extraContext?: unknown }>;
  getScopes(tokenRepresentation: any): Promise<string[]>;
  getDisplayValues(tokenRepresentation: any): Promise<ApiClientGroupDisplay>;
}

export interface IAttachCompanySpecificMiddleware {
  repoPermissions?: ICompanySpecificRepoPermissionsMiddlewareCalls;
  teamPermissions?: ICompanySpecificTeamPermissionsMiddlewareCalls;
  authentication: ICompanySpecificAuthenticationCalls;
}
