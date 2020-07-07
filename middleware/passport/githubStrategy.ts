import { IProviders } from "../../transitional";
import { Operations } from "../../business/operations";

import { Strategy as GitHubStrategy } from 'passport-github';

function githubResponseToSubset(app, modernAppInUse: boolean, accessToken: string, refreshToken: string, profile, done) {
  const config = app.settings.runtimeConfig;
  const providers = app.settings.providers as IProviders;
  if (config && config.impersonation && config.impersonation.githubId) {
    const operations = providers.operations as Operations;
    const impersonationId = config.impersonation.githubId;

    const account = operations.getAccount(impersonationId);
    return account.getDetails().then(details => {
      console.warn(`GITHUB IMPERSONATION: id=${impersonationId} login=${details.login} name=${details.name}`);
      return done(null, {
        github: {
          accessToken: 'fakeaccesstoken',
          displayName: details.name,
          avatarUrl: details.avatar_url,
          id: details.id.toString(),
          username: details.login,
        },
      });
    }).catch(err => {
      return done(err);
    });
  }
  let subset = {
    github: {
      accessToken: accessToken,
      displayName: profile.displayName,
      avatarUrl: profile._json && profile._json.avatar_url ? profile._json.avatar_url : undefined,
      id: profile.id,
      username: profile.username,
      scope: undefined,
    },
  };
  if (modernAppInUse) {
    subset.github.scope = 'githubapp';
  }
  return done(null, subset);
}

function githubResponseToIncreasedScopeSubset(modernAppInUse: boolean, accessToken: string, refreshToken: string, profile, done) {
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

export function getGitHubAppConfigurationOptions(config) {
  let legacyOAuthApp = config.github.oauth2 && config.github.oauth2.clientId && config.github.oauth2.clientSecret ? config.github.oauth2 : null;
  const customerFacingApp = config.github.app && config.github.app.ui && config.github.app.ui.clientId && config.github.app.ui.clientSecret ? config.github.app.ui : null;
  const useCustomerFacingGitHubAppIfPresent = config.github.oauth2.useCustomerFacingGitHubAppIfPresent === true;
  if (useCustomerFacingGitHubAppIfPresent && customerFacingApp) {
    if (legacyOAuthApp && legacyOAuthApp['callbackUrl']) {
      customerFacingApp['callbackUrl'] = legacyOAuthApp['callbackUrl'];
    }
    legacyOAuthApp = null;
  }
  const modernAppInUse: boolean = customerFacingApp && !legacyOAuthApp;
  const githubAppConfiguration = modernAppInUse ? customerFacingApp : legacyOAuthApp;
  return { legacyOAuthApp, customerFacingApp, modernAppInUse, githubAppConfiguration };
}

export default function createGitHubStrategy(app, config) {
  let strategies = {};
  const { modernAppInUse, githubAppConfiguration } = getGitHubAppConfigurationOptions(config);
  // NOTE: due to bugs in the GitHub API v3 around user-to-server requests in
  // the new GitHub model, it is better to use an original GitHub OAuth app
  // for user interaction right now until those bugs are corrected. What this
  // does mean is that any GitHub org that should be managed by this portal
  // needs the OAuth app to be authorized as a third-party app for the org or
  // to have the auto-accept invite experience work. (9/24/2019)
  if (modernAppInUse) {
    console.log(`GitHub App for customer-facing OAuth in use, client ID=${githubAppConfiguration.clientId}`);
  } else {
    console.log(`Legacy GitHub OAuth app being used for customers, client ID=${githubAppConfiguration.clientId}`);
  }
  // ----------------------------------------------------------------------------
  // GitHub Passport session setup.
  // ----------------------------------------------------------------------------
  let githubOptions = {
    clientID: githubAppConfiguration.clientId,
    clientSecret: githubAppConfiguration.clientSecret,
    callbackURL: undefined,
    scope: [],
    userAgent: 'passport-azure-oss-portal-for-github' // CONSIDER: User agent should be configured.
  };
  if (githubAppConfiguration.callbackUrl) {
    githubOptions.callbackURL = githubAppConfiguration.callbackUrl
  }
  let githubPassportStrategy = new GitHubStrategy(githubOptions, githubResponseToSubset.bind(null, app, modernAppInUse));
  // Validate the borrow some parameters from the GitHub passport library

  strategies['github'] = githubPassportStrategy;

  // ----------------------------------------------------------------------------
  // Expanded OAuth-scope GitHub access for org membership writes.
  // ----------------------------------------------------------------------------
  if (!modernAppInUse) { // new GitHub Apps no longer have a separate scope concept
    let expandedGitHubScopeStrategy = new GitHubStrategy({
      clientID: githubOptions.clientID,
      clientSecret: githubOptions.clientSecret,
      callbackURL: `${githubOptions.callbackURL}/increased-scope`,
      scope: ['write:org'],
      userAgent: 'passport-azure-oss-portal-for-github' // CONSIDER: User agent should be configured.
    }, githubResponseToIncreasedScopeSubset.bind(null, modernAppInUse));

    strategies['expanded-github-scope'] = expandedGitHubScopeStrategy;
  }
  return strategies;
}
