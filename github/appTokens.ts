//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { App as GitHubApp } from '@octokit/app';
import { AppPurpose } from '.';
import { IAuthorizationHeaderValue } from '../transitional';

const InstallationTokenLifetimeMilliseconds = 1000 * 60 * 60;
const ValidityOffsetAfterNowMilliseconds = 1000 * 120; // how long to require validity in the future

interface IInstallationToken {
  installationId: number;
  organizationName: string;
  requested: Date;

  expires: Date;
  headerValue: string;
}

export class GitHubAppTokens {
  public purpose: AppPurpose;

  private _app: GitHubApp;
  private _tokensByInstallation = new Map<number, IInstallationToken[]>();

  static CreateFromBase64EncodedFileString(purpose: AppPurpose, friendlyName: string, applicationId: number, fileContents: string): GitHubAppTokens {
    let keyContents = Buffer.from(fileContents, 'base64').toString('utf8').replace(/\r\n/g, '\n');
    return new GitHubAppTokens(purpose, friendlyName, applicationId, keyContents);
  }

  static CreateFromString(purpose: AppPurpose, friendlyName: string, applicationId: number, value: string): GitHubAppTokens {
    return new GitHubAppTokens(purpose, friendlyName, applicationId, value);
  }

  constructor(purpose: AppPurpose, public friendlyName: string, applicationId: number, privateKey: string) {
    this._app = new GitHubApp({ id: applicationId, privateKey, cache: alwaysEmptyCache() });
    this.purpose = purpose;
  }

  getSignedJsonWebToken() {
    return this._app.getSignedJsonWebToken();
  }

  async getInstallationToken(installationId: number, organizationName: string): Promise<IAuthorizationHeaderValue> {
    const now = new Date();
    const requiredValidityPeriod = new Date(now.getTime() + ValidityOffsetAfterNowMilliseconds);
    const latestToken = this.getLatestValidToken(installationId, requiredValidityPeriod);
    if (latestToken) {
      return { value: latestToken.headerValue, purpose: this.purpose };
    }
    const requestedToken = await this.requestInstallationToken(installationId, organizationName);
    this.getInstallationTokens(installationId).push(requestedToken);
    return { value: requestedToken.headerValue, purpose: this.purpose };
  }

  private async requestInstallationToken(installationId: number, organizationName: string): Promise<IInstallationToken> {
    try {
      const requested = new Date();
      const installationToken = await this._app.getInstallationAccessToken({ installationId });
      const headerValue = `token ${installationToken}`;
      const wrapped: IInstallationToken = {
        installationId,
        organizationName,
        requested,
        headerValue,
        expires: new Date(requested.getTime() + InstallationTokenLifetimeMilliseconds),
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
    tokens = tokens.filter(tokenValidFilter.bind(null, timeTokenMustBeValid )).sort(sortByLatestToken);
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
    console.log(`invalid or expired token being removed: expires=${token.expires} install_id=${token.installationId} org=${token.organizationName}`);
    return false;
  }
  return true;
}

function alwaysEmptyCache() {
  return {
    get: function() {
      return null;
    },
    set: function () {
    },
  };
}
