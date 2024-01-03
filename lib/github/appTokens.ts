//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { request } from '@octokit/request';
import { createAppAuth, InstallationAccessTokenAuthentication } from '@octokit/auth-app';
import { AppAuthentication, AuthInterface } from '@octokit/auth-app/dist-types/types';

import { AppPurposeTypes, ICustomAppPurpose } from './appPurposes';
import { AuthorizationHeaderValue } from '../../interfaces';

import Debug from 'debug';
import { CreateError } from '../transitional';
const debug = Debug('github:tokens');

interface IInstallationToken {
  installationId: number;
  organizationName: string;
  requested: Date;

  expires: Date;
  headerValue: string;
}

//type OctokitAuthFunction = AuthInterface<[AuthOptions], Authentication>;

const InstallationTokenLifetimeMilliseconds = 1000 * 60 * 60;
const ValidityOffsetAfterNowMilliseconds = 1000 * 120; // how long to require validity in the future

export enum GitHubTokenType {
  PersonalAccessToken = 'ghp',
  OAuthAccessToken = 'gho',
  UserToServerToken = 'ghu',
  ServerToServerToken = 'ghs',
  RefreshToken = 'ghr',
  FineGrainedPersonalAccessToken = 'github_pat',
}

export const GitHubTokenTypes = [
  GitHubTokenType.PersonalAccessToken,
  GitHubTokenType.OAuthAccessToken,
  GitHubTokenType.UserToServerToken,
  GitHubTokenType.ServerToServerToken,
  GitHubTokenType.RefreshToken,
  GitHubTokenType.FineGrainedPersonalAccessToken,
];

export function getGitHubTokenTypeFromValue(value: string | AuthorizationHeaderValue): GitHubTokenType {
  if (!value) {
    throw CreateError.ParameterRequired('value');
  }
  if (typeof value === 'object') {
    value = value.value;
  } else if (typeof value !== 'string') {
    throw CreateError.InvalidParameters('value must be a string or AuthorizationHeaderValue');
  }
  if (!value.startsWith('token ')) {
    throw CreateError.InvalidParameters('value must start with "token "');
  }
  const tokenValue = value.substr(6);
  for (const tokenType of GitHubTokenTypes) {
    if (tokenValue.startsWith(tokenType)) {
      return tokenType;
    }
  }
  throw CreateError.InvalidParameters('value does not appear to be a GitHub token');
}

export class GitHubAppTokens {
  #privateKey: string;
  private _appId: number;
  public purpose: AppPurposeTypes;
  private _purposeId: string;
  private _appAuth: AuthInterface;
  private _installationAuth = new Map<number, AuthInterface>();
  private _tokensByInstallation = new Map<number, IInstallationToken[]>();
  private _baseUrl: string;

  static CreateFromBase64EncodedFileString(
    purpose: AppPurposeTypes,
    slug: string,
    friendlyName: string,
    applicationId: number,
    fileContents: string,
    baseUrl?: string
  ): GitHubAppTokens {
    const keyContents = Buffer.from(fileContents, 'base64').toString('utf8').replace(/\r\n/g, '\n');
    return new GitHubAppTokens(purpose, slug, friendlyName, applicationId, keyContents, baseUrl);
  }

  static CreateFromString(
    purpose: AppPurposeTypes,
    slug: string,
    friendlyName: string,
    applicationId: number,
    value: string,
    baseUrl?: string
  ): GitHubAppTokens {
    return new GitHubAppTokens(purpose, slug, friendlyName, applicationId, value, baseUrl);
  }

  get appId() {
    return this._appId;
  }

  getPrivateCertificate() {
    return this.#privateKey;
  }

  constructor(
    purpose: AppPurposeTypes,
    public slug: string,
    public friendlyName: string,
    appId: number,
    privateKey: string,
    baseUrl?: string
  ) {
    this.#privateKey = privateKey;
    this._appId = appId;
    this._baseUrl = baseUrl;
    this._appAuth = createAppAuth({
      appId,
      privateKey,
      request: request.defaults({
        baseUrl,
      }),
    });
    this.purpose = purpose;
    const asCustomPurpose = purpose as ICustomAppPurpose;
    this._purposeId =
      asCustomPurpose?.isCustomAppPurpose === true ? asCustomPurpose?.id : (purpose as string);
  }

  async getAppAuthenticationToken() {
    const details = await this._appAuth({ type: 'app' });
    const token = (details as AppAuthentication).token;
    return token;
  }

  private getOrCreateInstallationAuthFunction(installationId: number) {
    let auth = this._installationAuth.get(installationId);
    if (!auth) {
      auth = createAppAuth({
        appId: this._appId,
        privateKey: this.#privateKey,
        installationId,
        request: request.defaults({
          baseUrl: this._baseUrl,
        }),
      });
      this._installationAuth.set(installationId, auth);
    }
    return auth;
  }

  async getInstallationToken(
    installationId: number,
    organizationName: string
  ): Promise<AuthorizationHeaderValue> {
    const now = new Date();
    const requiredValidityPeriod = new Date(now.getTime() + ValidityOffsetAfterNowMilliseconds);
    const latestToken = this.getLatestValidToken(installationId, requiredValidityPeriod);
    if (latestToken) {
      const source = `Existing installation ID ${installationId} token for ${organizationName} app ID ${this._appId} purpose ${this._purposeId}`;
      debug(source);
      return {
        value: latestToken.headerValue,
        purpose: this.purpose,
        installationId,
        organizationName,
        source,
      };
    }
    try {
      const requestedToken = await this.requestInstallationToken(installationId, organizationName);
      this.getInstallationTokens(installationId).push(requestedToken);
      const source = `New token for ${organizationName} organization via installation ID ${installationId} app ID ${this._appId} purpose ${this._purposeId}`;
      debug(source);
      return {
        value: requestedToken.headerValue,
        purpose: this.purpose,
        installationId,
        organizationName,
        source,
      };
    } catch (error) {
      console.warn(
        `Error retrieving installation token ID ${installationId} for organization ${organizationName} app ID ${this._appId} purpose ${this._purposeId}`
      );
      throw error;
    }
  }

  private async requestInstallationToken(
    installationId: number,
    organizationName: string
  ): Promise<IInstallationToken> {
    try {
      const requested = new Date();
      const installationAppAuth = this.getOrCreateInstallationAuthFunction(installationId);
      const installationTokenDetails = await installationAppAuth({ type: 'installation' });
      const installationToken = (installationTokenDetails as InstallationAccessTokenAuthentication).token;
      const headerValue = `token ${installationToken}`;
      const expiresFromDetails = (installationTokenDetails as any).expiresAt;
      const expires = expiresFromDetails
        ? new Date(expiresFromDetails)
        : new Date(requested.getTime() + InstallationTokenLifetimeMilliseconds);
      const wrapped: IInstallationToken = {
        installationId,
        organizationName,
        requested,
        headerValue,
        expires,
      };
      return wrapped;
    } catch (getTokenError) {
      console.dir(getTokenError);
      throw getTokenError;
    }
  }

  private getLatestValidToken(installationId: number, timeTokenMustBeValid: Date): IInstallationToken {
    let tokens = this.getInstallationTokens(installationId);
    const count = tokens.length;
    tokens = tokens.filter(tokenValidFilter.bind(null, timeTokenMustBeValid)).sort(sortByLatestToken);
    if (tokens.length !== count) {
      this.replaceInstallationTokens(installationId, tokens);
    }
    return tokens.length > 0 ? tokens[0] : null;
  }

  private getInstallationTokens(installationId: number): IInstallationToken[] {
    let bin = this._tokensByInstallation.get(installationId);
    if (!bin) {
      bin = [];
      this._tokensByInstallation.set(installationId, bin);
    }
    return bin;
  }

  private replaceInstallationTokens(installationId: number, arr: IInstallationToken[]) {
    this._tokensByInstallation.set(installationId, arr);
  }
}

function sortByLatestToken(a: IInstallationToken, b: IInstallationToken) {
  if (a > b) {
    return -1;
  } else if (a < b) {
    return 1;
  }
  return 0;
}

function tokenValidFilter(timeTokenMustBeValid: Date, token: IInstallationToken) {
  const isValid = token.expires > timeTokenMustBeValid;
  if (!isValid) {
    const header = token.headerValue.substr(6);
    const subset = (header.length > 12 ? header.substr(0, 8) : '') + '*'.repeat(4);
    console.log(
      `token expired: redacted=${subset}, expires=${token.expires.toISOString()}, install_id=${
        token.installationId
      }, org=${token.organizationName}`
    );
    return false;
  }
  return true;
}
