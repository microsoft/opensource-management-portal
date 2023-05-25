//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Session } from 'express-session';
import { Request, Response } from 'express';
import { AccessToken } from 'simple-oauth2';

import type { TelemetryClient } from 'applicationinsights';
import type { IReposApplication } from './app';

import { Organization, Team } from '../business';
import { IndividualContext } from '../business/user';

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
}

export interface ReposAppRequest extends Request {
  // passport
  isAuthenticated(): boolean;
  user: any;

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

  // FUTURE:
  apiContext: IndividualContext;
  individualContext: IndividualContext;
  oauthAccessToken: AccessToken;
}

export interface IUserAlert {
  message: string;
  title: string;
  context: UserAlertType;
  optionalLink: string;
  optionalCaption: string;
}

interface IAppSessionProperties extends Session {
  enableMultipleAccounts: boolean;
  selectedGithubId: string;
  passport: any;
  id: string;
  alerts?: IUserAlert[];
  referer: string;
}

export interface IAppSession extends IAppSessionProperties {}

export interface IReposAppResponse extends Response {}

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
