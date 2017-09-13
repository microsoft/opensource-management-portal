//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const passport = require('passport');
const serializer = require('./passport/serializer');
const GitHubStrategy = require('../thirdparty/passport-github').Strategy;
const OIDCStrategy = require('passport-azure-ad').OIDCStrategy;

// FYI: GitHub does not provide refresh tokens

function githubResponseToSubset(accessToken, refreshToken, profile, done) {
  let subset = {
    github: {
      accessToken: accessToken,
      displayName: profile.displayName,
      avatarUrl: profile._json && profile._json.avatar_url ? profile._json.avatar_url : undefined,
      id: profile.id,
      username: profile.username,
    },
  };
  return done(null, subset);
}

function githubResponseToIncreasedScopeSubset(accessToken, refreshToken, profile, done) {
  let subset = {
    githubIncreasedScope: {
      accessToken: accessToken,
      id: profile.id,
      username: profile.username,
    },
  };
  return done(null, subset);
}

function activeDirectorySubset(iss, sub, profile, done) {
  // CONSIDER: TODO: Hybrid tenant checks.
  // Internal-only code:
  // ----------------------------------------------------------------
  // We've identified users with e-mail addresses in AAD similar to
  // myoutlookaddress#live.com. These are where people have had work
  // shared with them through a service like Office 365; these users
  // are not technically employees with active credentials, and so
  // they should *not* have access. We reject here before the
  // session tokens can be saved.
  // if (username && username.indexOf && username.indexOf('#') >= 0) {
  //   return next(new Error('Your hybrid tenant account, ' + username + ', is not permitted for this resource. Were you invited as an outside collaborator by accident? Please contact us if you have any questions.'));
  // }
  let subset = {
    azure: {
      displayName: profile.displayName,
      oid: profile.oid,
      username: profile.upn,
    },
  };
  done(null, subset);
}

module.exports = function (app, config) {
  if (!config.authentication.scheme) {
    config.authentication.scheme = 'github';
  }
  if (config.authentication.scheme !== 'github' && config.authentication.scheme !== 'aad') {
    throw new Error(`Unsupported primary authentication scheme type "${config.authentication.scheme}"`);
  }

  // ----------------------------------------------------------------------------
  // GitHub Passport session setup.
  // ----------------------------------------------------------------------------
  let githubOptions = {
    clientID: config.github.oauth2.clientId,
    clientSecret: config.github.oauth2.clientSecret,
    callbackURL: config.github.oauth2.callbackUrl,
    appInsightsClient: app.get('appInsightsClient'),
    scope: [],
    userAgent: 'passport-azure-oss-portal-for-github' // CONSIDER: User agent should be configured.
  };
  let githubPassportStrategy = new GitHubStrategy(githubOptions, githubResponseToSubset);
  let aadStrategy = new OIDCStrategy({
    redirectUrl: config.activeDirectory.redirectUrl,
    allowHttpForRedirectUrl: config.containers.docker || config.webServer.allowHttp,
    realm: config.activeDirectory.tenantId,
    clientID: config.activeDirectory.clientId,
    clientSecret: config.activeDirectory.clientSecret,
    oidcIssuer: config.activeDirectory.issuer,
    identityMetadata: 'https://login.microsoftonline.com/' + config.activeDirectory.tenantId + '/.well-known/openid-configuration',
    responseType: 'id_token code',
    responseMode: 'form_post',
    validateIssuer: true,
  }, activeDirectorySubset);

  // Patching the AAD strategy to intercept a specific state failure message and instead
  // of providing a generic failure message, redirecting (HTTP GET) to the callback page
  // where we can offer a more useful message
  const originalFailWithLog = aadStrategy.failWithLog;
  aadStrategy.failWithLog = function () {
    const args = Array.prototype.slice.call(arguments);
    const messageToIntercept = 'In collectInfoFromReq: invalid state received in the request';
    if (args.length === 1 && typeof(args[0]) === 'string' && args[0] === messageToIntercept) {
      return this.redirect('/auth/azure/callback?failure=invalid');
    }
    originalFailWithLog.call(this, args);
  };

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
    clientID: config.github.oauth2.clientId,
    clientSecret: config.github.oauth2.clientSecret,
    callbackURL: config.github.oauth2.callbackUrl + '/increased-scope',
    scope: ['write:org'],
    userAgent: 'passport-azure-oss-portal-for-github' // CONSIDER: User agent should be configured.
  }, githubResponseToIncreasedScopeSubset);

  passport.use('expanded-github-scope', expandedGitHubScopeStrategy);

  app.use(passport.initialize());
  app.use(passport.session());

  const serializerOptions = {
    config: config,
    keyResolver: app.get('keyEncryptionKeyResolver'),
  };

  passport.serializeUser(serializer.serialize(serializerOptions));
  passport.deserializeUser(serializer.deserialize(serializerOptions));
  serializer.initialize(serializerOptions, app);

  app.use((req, res, next) => {
    if (req.insights && req.insights.properties && config.authentication.scheme === 'aad' && req.user && req.user.azure) {
      req.insights.properties.aadId = req.user.azure.oid;
    }
    next();
  });

  return passport;
};
