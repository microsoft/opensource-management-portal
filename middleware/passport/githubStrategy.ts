//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Strategy as GithubStrategy } from 'passport-github';

import {
  getCodespacesHostname,
  isCodespacesAuthenticating,
  isEnterpriseManagedUserLogin,
} from '../../lib/utils';
import type {
  IGitHubAccountDetails,
  IProviders,
  IReposApplication,
  SiteConfiguration,
} from '../../interfaces';
import type { ConfigGitHubCodespaces } from '../../config/github.codespaces.types';

import Debug from 'debug';
import { ConfigGitHubOAuth2 } from '../../config/github.oauth2.types';
const debug = Debug.debug('startup');

export const githubStrategyName = 'github';
export const githubIncreasedScopeStrategyName = 'expanded-github-scope';
export const githubStrategyUserPropertyName = 'github';
export const githubIncreasedScopeStrategyUserPropertyName = 'githubIncreasedScope';

interface IPassportGitHubIdentityProfile {
  _json: IGitHubAccountDetails;
  _raw: string; // JSON
  displayName: string;
  emails: any; // { 0: value: string, ...}
  id: string; // it is a string, not a number
  photos: any; // { 0: value: string, ...}
  profileUrl: string;
  provider: 'github';
  username: string;
}

interface IGitHubIdentitySubset {
  accessToken: string;
  displayName: string;
  avatarUrl: string;
  id: string; // GitHub returns a number
  username: string;
  scope?: string;
}

type IdentitySubset = {
  github: IGitHubIdentitySubset;
};

function impersonatedIdentityFromDetails(
  details: IGitHubAccountDetails,
  accessTokenReplacement?: string
): IGitHubIdentitySubset {
  return {
    accessToken: 'fakeaccesstoken' || accessTokenReplacement, // by design, do not allow a real access token to be used
    displayName: details.name,
    avatarUrl: details.avatar_url,
    id: String(details.id),
    username: details.login,
  };
}

function githubResponseToSubset(
  app: IReposApplication,
  modernAppInUse: boolean,
  accessToken: string,
  refreshToken: string,
  profile: IPassportGitHubIdentityProfile,
  done
) {
  return githubResponseToSubsetEx(app, modernAppInUse, accessToken, refreshToken, profile)
    .then((github) => {
      const subset: IdentitySubset = { github };
      return done(null, subset);
    })
    .catch((error) => {
      return done(error);
    });
}

async function githubResponseToSubsetEx(
  app: IReposApplication,
  modernAppInUse: boolean,
  accessToken: string,
  refreshToken: string,
  profile: IPassportGitHubIdentityProfile
): Promise<IGitHubIdentitySubset> {
  const providers = app.settings.providers as IProviders;
  const { config, operations } = providers;
  const codespacesConfig = config?.github?.codespaces;
  const impersonateOverrideEmuAccount =
    codespacesConfig?.authentication?.github?.impersonateOverrideEmuAccount;
  const { useIncreasedScopeLegacyAppIfNeeded } = getGithubAppConfigurationOptions(config);
  // GitHub Codespaces-only override for Enterprise Managed Users
  if (!codespacesConfig?.block && impersonateOverrideEmuAccount?.enabled) {
    const { login } = impersonateOverrideEmuAccount;
    if (profile?.username && isEnterpriseManagedUserLogin(profile.username)) {
      if (!login) {
        throw new Error('No Codespaces EMU override is enabled. Please configure the environment you need.');
      }
      const account = await operations.getAccountByUsername(login);
      const details = account.getEntity();
      return impersonatedIdentityFromDetails(details, 'emu-override-fake-token');
    }
  }
  // Debug impersonation
  if (config?.impersonation?.githubId) {
    const impersonationId = config.impersonation.githubId;
    const account = operations.getAccount(impersonationId);
    const details = await account.getDetails();
    console.warn(`GITHUB IMPERSONATION: id=${impersonationId} login=${details.login} name=${details.name}`);
    return impersonatedIdentityFromDetails(details);
  }
  // Standard authentication flow
  const github: IGitHubIdentitySubset = {
    accessToken: accessToken,
    displayName: profile.displayName,
    avatarUrl: profile._json && profile._json.avatar_url ? profile._json.avatar_url : undefined,
    id: profile.id,
    username: profile.username,
    scope: undefined,
  };
  if (modernAppInUse) {
    github.scope = 'githubapp';
  } else if (useIncreasedScopeLegacyAppIfNeeded && !modernAppInUse) {
    github.scope = 'githubapp'; // for local development validation of this interesting scenario only
  }
  return github;
}

function githubResponseToIncreasedScopeSubset(
  modernAppInUse: boolean,
  accessToken: string,
  refreshToken: string,
  profile,
  done
) {
  if (modernAppInUse) {
    return done(new Error('githubResponseToIncreasedScopeSubset is not compatible with modern apps'));
  }
  const subset = {
    githubIncreasedScope: {
      accessToken: accessToken,
      id: profile.id,
      username: profile.username,
    },
  };
  return done(null, subset);
}

export function getGithubAppConfigurationOptions(config: SiteConfiguration) {
  let legacyOAuthApp =
    config?.github?.oauth2?.clientId && config?.github?.oauth2?.clientSecret ? config.github.oauth2 : null;
  const customerFacingApp =
    config.github.app?.ui?.clientId && config.github.app.ui.clientSecret ? config.github.app.ui : null;
  const useCustomerFacingGithubAppIfPresent =
    config.github.oauth2.useCustomerFacingGitHubAppIfPresent === true;
  const useIncreasedScopeLegacyAppIfNeeded =
    config.github.oauth2.useIncreasedScopeCustomerFacingIfNeeded === true;
  if (useCustomerFacingGithubAppIfPresent && customerFacingApp) {
    if (legacyOAuthApp && legacyOAuthApp['callbackUrl']) {
      customerFacingApp['callbackUrl'] = legacyOAuthApp['callbackUrl'];
    }
    legacyOAuthApp = null;
  }
  const modernAppInUse: boolean = customerFacingApp && !legacyOAuthApp;
  const githubAppConfiguration = modernAppInUse ? customerFacingApp : legacyOAuthApp;
  return {
    legacyOAuthApp,
    customerFacingApp,
    modernAppInUse,
    githubAppConfiguration,
    useIncreasedScopeLegacyAppIfNeeded,
  };
}

export default function createGithubStrategy(app: IReposApplication, config: SiteConfiguration) {
  const strategies = {};
  const codespaces = config?.github?.codespaces || ({} as ConfigGitHubCodespaces);
  const { modernAppInUse, githubAppConfiguration, useIncreasedScopeLegacyAppIfNeeded } =
    getGithubAppConfigurationOptions(config);
  if (!githubAppConfiguration?.clientId) {
    // CONSIDER: for development, this might be fine, but it might be important
    // to be configurable whether this is a fatal startup error or a stdout warning.
    debug('No GitHub App configured, linking will not be available.');
    return strategies;
  }
  const redirectSuffix = '/auth/github/callback';
  const finalCallbackUrl =
    isCodespacesAuthenticating(config, 'github') && !codespaces?.block
      ? getCodespacesHostname(config) + redirectSuffix
      : (githubAppConfiguration as ConfigGitHubOAuth2)?.callbackUrl;
  let clientId = githubAppConfiguration.clientId;
  let clientSecret = githubAppConfiguration.clientSecret;
  let codespacesOverrideText = '';
  if (codespaces?.authentication?.github?.enabled && codespaces.authentication.github.clientId) {
    codespacesOverrideText = ' (using GitHub Codespaces secrets)';
    clientId = codespaces.authentication.github.clientId;
    clientSecret = codespaces.authentication.github.clientSecret;
    if (!clientSecret) {
      throw new Error(
        "Missing Codespaces client secret value in 'github.codespaces.authentication.github.clientId'"
      );
    }
  }
  if (modernAppInUse) {
    debug(`github app for users, client=${clientId}, callback=${finalCallbackUrl}${codespacesOverrideText}`);
  } else {
    debug(
      `legacy github oauth app for users, client=${clientId}, callback=${finalCallbackUrl}${codespacesOverrideText}`
    );
  }
  const writeOrgScopes = ['write:org'];
  const scope = useIncreasedScopeLegacyAppIfNeeded && !modernAppInUse ? writeOrgScopes : [];
  if (useIncreasedScopeLegacyAppIfNeeded && !modernAppInUse) {
    debug(`Legacy GitHub OAuth app will use the expanded token with org-write scope`);
  }
  const githubOptions = {
    clientID: clientId,
    clientSecret,
    callbackURL: undefined,
    scope,
    userAgent: 'passport-azure-oss-portal-for-github', // CONSIDER: User agent should be configured.
  };
  if (finalCallbackUrl) {
    githubOptions.callbackURL = finalCallbackUrl;
  }
  const githubPassportStrategy = new GithubStrategy(
    githubOptions,
    githubResponseToSubset.bind(null, app, modernAppInUse)
  );
  // Validate the borrow some parameters from the GitHub passport library
  strategies[githubStrategyName] = githubPassportStrategy;
  // Expanded OAuth-scope GitHub access for org membership writes.
  if (!modernAppInUse) {
    // new GitHub Apps no longer have a separate scope concept
    const expandedGithubScopeStrategy = new GithubStrategy(
      {
        clientID: githubOptions.clientID,
        clientSecret: githubOptions.clientSecret,
        callbackURL: `${githubOptions.callbackURL}/increased-scope`,
        scope: writeOrgScopes,
        userAgent: 'passport-azure-oss-portal-for-github', // CONSIDER: User agent should be configured.
      },
      githubResponseToIncreasedScopeSubset.bind(null, modernAppInUse)
    );
    strategies[githubIncreasedScopeStrategyName] = expandedGithubScopeStrategy;
  }
  return strategies;
}
