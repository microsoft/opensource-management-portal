//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { createHash, createPublicKey } from 'crypto';
import { request } from '@octokit/request';
import { base64url } from 'jose';
import { AppAuthentication, createAppAuth } from '@octokit/auth-app';

import { AppPurposeTypes, ICustomAppPurpose } from './appPurposes.js';
import Debug from 'debug';
import { CreateError } from '../transitional.js';
import { getKeyVaultKeyCryptographyClient } from '../signing.js';

import type { AuthorizationHeaderValue, IProviders } from '../../interfaces/index.js';
import { CryptographyClient } from '@azure/keyvault-keys';

const debug = Debug('github:tokens');

type AuthInterface = ReturnType<typeof createAppAuth>;

type InstallationToken = {
  installationId: number;
  organizationName: string;
  requested: Date;

  created: Date;
  expires: Date;
  headerValue: string;

  permissions?: GitHubTokenPermissions;
  impliedTargetType?: 'organization' | 'enterprise';
};

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

export type GitHubTokenPermissions = Record<string, string>;

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
  private _remoteJwtUrl: string;
  private _appId: number;
  public purpose: AppPurposeTypes;
  private _purposeId: string;
  private _appAuth: AuthInterface;
  private _installationAuth = new Map<number, AuthInterface>();
  private _tokensByInstallation = new Map<number, InstallationToken[]>();
  private _knownInstallationIdTypes = new Map<number, 'organization' | 'enterprise'>();
  private _baseUrl: string;

  static CreateFromBase64EncodedFileString(
    providers: IProviders,
    purpose: AppPurposeTypes,
    slug: string,
    friendlyName: string,
    applicationId: number,
    fileContents: string,
    baseUrl?: string
  ): GitHubAppTokens {
    const keyContents = Buffer.from(fileContents, 'base64').toString('utf8').replace(/\r\n/g, '\n');
    return new GitHubAppTokens(
      providers,
      purpose,
      slug,
      friendlyName,
      applicationId,
      'privateKey',
      keyContents,
      baseUrl
    );
  }

  static CreateFromString(
    providers: IProviders,
    purpose: AppPurposeTypes,
    slug: string,
    friendlyName: string,
    applicationId: number,
    value: string,
    baseUrl?: string
  ): GitHubAppTokens {
    return new GitHubAppTokens(
      providers,
      purpose,
      slug,
      friendlyName,
      applicationId,
      'privateKey',
      value,
      baseUrl
    );
  }

  static CreateWithExternalJwtSigning(
    providers: IProviders,
    purpose: AppPurposeTypes,
    slug: string,
    friendlyName: string,
    applicationId: number,
    remoteJwtKeyUrl: string,
    baseUrl?: string
  ): GitHubAppTokens {
    return new GitHubAppTokens(
      providers,
      purpose,
      slug,
      friendlyName,
      applicationId,
      'remoteJwt',
      remoteJwtKeyUrl,
      baseUrl
    );
  }

  get appId() {
    return this._appId;
  }

  private getPrivateCertificate() {
    if (this.mode === 'privateKey') {
      return this.#privateKey;
    }
    throw CreateError.InvalidParameters('Private key is not available for app ' + this.slug);
  }

  getCertificateSha256() {
    if (this.mode === 'remoteJwt') {
      return `SHA256:unknown(remote)`;
    }

    // This is how GitHub Apps are reported in the user interface for App Managers to view.
    const pem = this.getPrivateCertificate();
    const publicKey = createPublicKey(pem);
    const publicKeyDer = publicKey.export({
      type: 'spki',
      format: 'der',
    });
    const sha256 = createHash('sha256').update(publicKeyDer).digest('base64');
    return `SHA256:${sha256}`;
  }

  constructor(
    private providers: IProviders,
    purpose: AppPurposeTypes,
    public slug: string,
    public friendlyName: string,
    appId: number,
    private mode: 'privateKey' | 'remoteJwt',
    privateKey: string,
    baseUrl?: string
  ) {
    let key: string;
    let createJwt:
      | undefined
      | ((clientIdOrAppId: string | number) => Promise<{ jwt: string; expiresAt: Date }>);
    if (mode === 'privateKey') {
      this.#privateKey = privateKey;
      key = privateKey;
    } else if (mode === 'remoteJwt') {
      this._remoteJwtUrl = privateKey;
      createJwt = this.remotelySignJwt.bind(this);
    }
    this._appId = appId;
    this._baseUrl = baseUrl;
    this._appAuth = createAppAuth({
      appId,
      privateKey: key,
      createJwt,
      request: request.defaults({
        baseUrl,
      }),
    });
    this.purpose = purpose;
    const asCustomPurpose = purpose as ICustomAppPurpose;
    this._purposeId =
      asCustomPurpose?.isCustomAppPurpose === true ? asCustomPurpose?.id : (purpose as string);
  }

  private async remotelySignJwt(clientIdOrAppId: string | number): Promise<{ jwt: string; expiresAt: Date }> {
    const signUrl = this._remoteJwtUrl;
    const { insights } = this.providers;
    if (!signUrl) {
      throw CreateError.InvalidParameters('Missing remote JWT signing URL from configuration');
    }
    let stage = 'acquiring crypto client';
    let cryptoClient: CryptographyClient;
    try {
      insights?.trackEvent({
        name: 'github_app.remote_jwt_sign.start',
        properties: {
          signUrl,
          clientIdOrAppId,
        },
      });
      cryptoClient = await getKeyVaultKeyCryptographyClient(this.providers, signUrl);
      stage = 'preparing payload';
      const header = { alg: 'RS256', typ: 'JWT' };
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iat: now - 60,
        exp: now + 10 * 60,
        iss: clientIdOrAppId,
      };
      const expiresAt = new Date(payload.exp * 1000);
      const encodedHeader = base64url.encode(JSON.stringify(header));
      const encodedPayload = base64url.encode(JSON.stringify(payload));
      const signingInput = `${encodedHeader}.${encodedPayload}`;
      const encoder = new TextEncoder();
      const signingInputBytes = encoder.encode(signingInput);
      const hash = createHash('sha256').update(signingInputBytes).digest();
      stage = 'signing with remote key';
      const signResult = await cryptoClient.sign('RS256', hash);
      stage = 'signed';
      const signature = base64url.encode(signResult.result);
      insights?.trackEvent({
        name: 'github_app.remote_jwt_sign.signed',
        properties: {
          signUrl,
          clientIdOrAppId,
          iat: payload.iat,
          exp: payload.exp,
        },
      });
      insights?.trackMetric({
        name: 'github_app.remote_jwt_sign.successes',
        value: 1,
      });
      const jwt = `${signingInput}.${signature}`;
      return { jwt, expiresAt };
    } catch (error) {
      insights?.trackException({
        exception: error,
        properties: {
          name: 'github_app.remote_jwt_sign.failed',
          signUrl,
          clientIdOrAppId,
        },
      });
      insights?.trackMetric({
        name: 'github_app.remote_jwt_sign.failures',
        value: 1,
      });
      throw CreateError.Wrap(
        `Unable to sign with key vault key at ${signUrl} (stage: ${stage}, client: ${clientIdOrAppId})`,
        error
      );
    }
  }

  async getAppAuthenticationToken() {
    const details = await this._appAuth({ type: 'app' });
    const token = (details as AppAuthentication).token;
    return token;
  }

  private getOrCreateInstallationAuthFunction(installationId: number) {
    let auth = this._installationAuth.get(installationId);
    if (!auth) {
      let privateKey: string;
      let createJwt: (clientIdOrAppId: string | number) => Promise<{ jwt: string; expiresAt: Date }>;
      if (this.mode === 'privateKey') {
        privateKey = this.#privateKey;
      } else if (this.mode === 'remoteJwt') {
        createJwt = this.remotelySignJwt.bind(this);
      }
      auth = createAppAuth({
        appId: this._appId,
        privateKey,
        createJwt,
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
      const impliedTargetString = latestToken?.impliedTargetType
        ? `for ${latestToken.impliedTargetType}`
        : 'for';
      const source = `Cached installation ID ${installationId} token ${impliedTargetString} ${organizationName} app ID ${this._appId} purpose ${this._purposeId}`;
      debug(source);
      return {
        value: latestToken.headerValue,
        purpose: this.purpose,
        installationId,
        organizationName,
        source,
        permissions: latestToken.permissions,
        impliedTargetType: latestToken.impliedTargetType,
        created: latestToken.created,
        expires: latestToken.expires,
      };
    }
    try {
      const requestedToken = await this.requestInstallationToken(installationId, organizationName);
      this.getInstallationTokens(installationId).push(requestedToken);
      const impliedTargetString = requestedToken?.impliedTargetType
        ? `for ${requestedToken.impliedTargetType}`
        : 'for';
      const source = `New token ${impliedTargetString} ${organizationName} via installation ID ${installationId} app ID ${this._appId} purpose ${this._purposeId}`;
      debug(source);
      return {
        value: requestedToken.headerValue,
        purpose: this.purpose,
        installationId,
        organizationName,
        source,
        permissions: requestedToken.permissions,
        impliedTargetType: requestedToken.impliedTargetType,
        created: requestedToken.created,
        expires: requestedToken.expires,
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
  ): Promise<InstallationToken> {
    let impliedType: 'organization' | 'enterprise' = 'organization';
    try {
      const requested = new Date();
      const installationAppAuth = this.getOrCreateInstallationAuthFunction(installationId);
      const installationTokenDetails = await installationAppAuth({ type: 'installation' });
      const installationToken = installationTokenDetails.token;
      const headerValue = `token ${installationToken}`;
      const expires = installationTokenDetails?.expiresAt
        ? new Date(installationTokenDetails.expiresAt)
        : new Date(requested.getTime() + InstallationTokenLifetimeMilliseconds);
      const permissions = installationTokenDetails.permissions;
      let knownInstallationType = this._knownInstallationIdTypes.get(installationId);
      if (knownInstallationType === undefined) {
        if (permissions) {
          const permissionKeys = Object.keys(permissions);
          for (const permissionKey of permissionKeys) {
            if (permissionKey.startsWith('enterprise_')) {
              impliedType = 'enterprise';
              break;
            }
          }
          knownInstallationType = impliedType;
          this._knownInstallationIdTypes.set(installationId, knownInstallationType);
        }
      }
      const created = installationTokenDetails.createdAt
        ? new Date(installationTokenDetails.createdAt)
        : requested;
      const wrapped: InstallationToken = {
        installationId,
        organizationName,
        requested,
        headerValue,
        created,
        expires,
        permissions,
        impliedTargetType: knownInstallationType,
      };
      return wrapped;
    } catch (getTokenError) {
      if (
        getTokenError?.status === 401 &&
        getTokenError.message?.includes('A JSON web token could not be decoded')
      ) {
        let publicSha256 = '[error w/public cert]';
        try {
          publicSha256 = 'public=' + this.getCertificateSha256();
        } catch (error) {
          console.warn(`Error retrieving public SHA256: ${error.message}`);
        }
        const additionalMessage = 'This could be a mismatched app ID and certificate'; // See also: https://github.com/octokit/octokit.net/issues/2833
        console.warn(
          `App id=${this._appId}, slug=${this.slug}, install=${installationId}, ${impliedType || 'organization'}=${organizationName}, ${publicSha256}; ${additionalMessage}: token error: ${getTokenError.message}`
        );
      } else {
        console.dir(getTokenError);
      }
      throw getTokenError;
    }
  }

  private getLatestValidToken(installationId: number, timeTokenMustBeValid: Date): InstallationToken {
    let tokens = this.getInstallationTokens(installationId);
    const count = tokens.length;
    tokens = tokens.filter(tokenValidFilter.bind(null, timeTokenMustBeValid)).sort(sortByLatestToken);
    if (tokens.length !== count) {
      this.replaceInstallationTokens(installationId, tokens);
    }
    return tokens.length > 0 ? tokens[0] : null;
  }

  private getInstallationTokens(installationId: number): InstallationToken[] {
    let bin = this._tokensByInstallation.get(installationId);
    if (!bin) {
      bin = [];
      this._tokensByInstallation.set(installationId, bin);
    }
    return bin;
  }

  private replaceInstallationTokens(installationId: number, arr: InstallationToken[]) {
    this._tokensByInstallation.set(installationId, arr);
  }
}

function sortByLatestToken(a: InstallationToken, b: InstallationToken) {
  if (a > b) {
    return -1;
  } else if (a < b) {
    return 1;
  }
  return 0;
}

function tokenValidFilter(timeTokenMustBeValid: Date, token: InstallationToken) {
  const isValid = token.expires > timeTokenMustBeValid;
  if (!isValid) {
    const header = token.headerValue.substr(6);
    const subset = (header.length > 12 ? header.substr(0, 8) : '') + '*'.repeat(4);
    debug(
      `token expired: redacted=${subset}, expires=${token.expires.toISOString()}, install_id=${
        token.installationId
      }, org=${token.organizationName}`
    );
    return false;
  }
  return true;
}
