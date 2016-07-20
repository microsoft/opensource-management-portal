//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const passport = require('passport');
const GitHubStrategy = require('passport-github').Strategy;
const OIDCStrategy = require('passport-azure-ad').OIDCStrategy;

function githubResponseToSubset(accessToken, refreshToken, profile, done) {
  let subset = {
    github: {
      accessToken: accessToken,
      avatarUrl: profile._json && profile._json.avatar_url ? profile._json.avatar_url : undefined,
      displayName: profile.displayName,
      id: profile.id,
      profileUrl: profile.profileUrl,
      username: profile.username,
    }
  };
  return done(null, subset);
}

function activeDirectorySubset(iss, sub, profile, accessToken, refreshToken, done) {
  // CONSIDER: TODO: Hybrid tenant checks.
  // CONSIDER: Should check for existance of UPN, OID
  let subset = {
    azure: {
      displayName: profile.displayName,
      oid: profile._json.oid,
      username: profile._json.upn,
      token: {
        access: accessToken,
        refresh: refreshToken,
        exp: profile._json.exp,
      },
    }
  };
  done(null, subset);
}

module.exports = function (app, config) {
  if (!config.primaryAuthenticationScheme) {
    config.primaryAuthenticationScheme = 'github';
  }
  if (config.primaryAuthenticationScheme !== 'github' && config.primaryAuthenticationScheme !== 'aad') {
    throw new Error(`Unsupported primary authentication scheme type "${config.primaryAuthenticationScheme}"`);
  }

  // ----------------------------------------------------------------------------
  // GitHub Passport session setup.
  // ----------------------------------------------------------------------------
  passport.serializeUser(function (user, done) {
    done(null, user);
  });
  passport.deserializeUser(function (obj, done) {
    done(null, obj);
  });
  let githubOptions = {
    clientID: config.github.clientId,
    clientSecret: config.github.clientSecret,
    callbackURL: config.github.callbackUrl,
    scope: [],
    userAgent: 'passport-azure-oss-portal-for-github' // CONSIDER: User agent should be configured.
  };
  let githubPassportStrategy = new GitHubStrategy(githubOptions, githubResponseToSubset);
  let aadStrategy = new OIDCStrategy({
    callbackURL: config.activeDirectory.redirectUrl,
    realm: config.activeDirectory.tenantId,
    clientID: config.activeDirectory.clientId,
    clientSecret: config.activeDirectory.clientSecret,
    oidcIssuer: config.activeDirectory.issuer,
    identityMetadata: 'https://login.microsoftonline.com/common/.well-known/openid-configuration',
    skipUserProfile: true,
    responseType: 'id_token code',
    responseMode: 'form_post',
    validateIssuer: true,
  }, activeDirectorySubset);

  // Validate the borrow some parameters from the GitHub passport library
  if (githubPassportStrategy._oauth2 && githubPassportStrategy._oauth2._authorizeUrl) {
    app.set('runtime/passport/github/authorizeUrl', githubPassportStrategy._oauth2._authorizeUrl);
  } else {
    throw new Error('The GitHub Passport strategy library may have been updated, it no longer contains the expected Authorize URL property within the OAuth2 object.');
  }
  if (githubPassportStrategy._scope && githubPassportStrategy._scopeSeparator) {
    app.set('runtime/passport/github/scope', githubPassportStrategy._scope.join(githubPassportStrategy._scopeSeparator));
  } else {
    throw new Error('The GitHub Passport strategy library may have been updated, it no longer contains the expected Authorize URL property within the OAuth2 object.');
  }

  passport.use('github', githubPassportStrategy);
  passport.use('azure-active-directory', aadStrategy);

  // ----------------------------------------------------------------------------
  // Expanded OAuth-scope GitHub access for org membership writes.
  // ----------------------------------------------------------------------------
  let expandedGitHubScopeStrategy = new GitHubStrategy({
    clientID: config.github.clientId,
    clientSecret: config.github.clientSecret,
    callbackURL: config.github.callbackUrl + '/increased-scope',
    scope: ['write:org'],
    userAgent: 'passport-azure-oss-portal-for-github' // CONSIDER: User agent should be configured.
  }, githubResponseToSubset);

  passport.use('expanded-github-scope', expandedGitHubScopeStrategy);

  app.use(passport.initialize());
  app.use(passport.session());

  return passport;
};
