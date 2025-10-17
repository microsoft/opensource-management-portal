//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Session } from 'express-session';
import { NextFunction, Request, Response } from 'express';
import { AccessToken } from 'simple-oauth2';

import type { TelemetryClient } from 'applicationinsights';
import type { IReposApplication } from './app.js';
import type { EntraApiTokenValidateResponse } from '../middleware/api/authentication/types.js';

import { Organization, Team } from '../business/index.js';
import { IndividualContext } from '../business/user/index.js';

export enum UserAlertType {
  Success = 'success',
  Warning = 'warning',
  Danger = 'danger',
}

export interface IReposAppContext {
  section?: string;
  pivotDirectlyToOtherOrg?: string;
  releaseTab?: boolean;
  organization?: Organization;
}

export interface IReposAppWithTeam extends ReposAppRequest {
  teamPermissions?: any;
  team2?: Team;
  teamUrl: string;
}

export enum LocalApiRepoAction {
  Delete = 'delete',
  Archive = 'archive',
  UnArchive = 'unarchive',
  Privatize = 'privatize',
}

export type VoidedExpressRoute = (req: ReposAppRequest, res: Response, next: NextFunction) => Promise<void>;
// req: Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>, res: Response<any, Record<string, any>, number>, next: NextFunction) => void | Promise<...>

export type ReposAppUser = {
  azure?: any;
  github?: any;
};

export interface ReposAppRequest extends Request {
  // passport
  // isAuthenticated(): boolean;
  user: ReposAppUser;

  app: IReposApplication;

  // our extensions
  insights?: TelemetryClient;
  reposContext?: IReposAppContext;
  currentOrganizationMemberships?: any; // needs a redesign
  teamsPagerMode?: string;
  reposPagerMode?: string;
  link?: any; // not sure when this is set
  organization?: Organization;
  correlationId?: string;
  scrubbedUrl?: string;

  apiContext: IndividualContext;
  individualContext: IndividualContext;
  watchdogContextOverride?: IndividualContext;
  oauthAccessToken: AccessToken;

  userOverwriteRequest?: ReposAppUser;
}

export const wrapErrorForImmediateUserError = (err: Error) => {
  (err as any).immediate = true;
  return err;
};

export type ApiRequestToken = {
  authenticationProvider: string;
  hasOrganizationScope: (scope: string) => boolean;
  hasScope: (scope: string) => boolean;
  hasAnyScope: (scopes: string[]) => boolean;
  hasScopePrefix: (scopePrefix: string) => boolean;
  displayUsername: string;
  token: EntraApiTokenValidateResponse;
  getScopes: () => string[];
  getMonikerSources: () => string[];
  extraContext?: unknown;
};

export type ReposApiRequest = ReposAppRequest & {
  apiKeyToken: ApiRequestToken;
  apiVersion?: string;

  userContextOverwriteRequest?: any;
};

export interface IUserAlert {
  message: string;
  title: string;
  context: UserAlertType;
  optionalLink: string;
  optionalCaption: string;
}

export interface IAppSession extends Session {
  enableMultipleAccounts: boolean;
  selectedGithubId: string;
  passport: any;
  id: string;
  alerts?: IUserAlert[];
  referer: string;
}

export interface IReposRequestWithOrganization extends ReposAppRequest {
  organization?: any;
}

export interface IRequestTeams extends ReposAppRequest {
  team2?: any;
  teamUrl?: any;
}

export interface RequestWithSystemwidePermissions extends ReposAppRequest {
  systemWidePermissions?: any;
}
