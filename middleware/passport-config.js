//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var passport = require('passport');
var utils = require('../utils');

var GitHubStrategy = require('passport-github').Strategy;
var OIDCStrategy = require('passport-azure-ad').OIDCStrategy;

module.exports = function (app, config) {
    // ----------------------------------------------------------------------------
    // GitHub Passport session setup.
    // ----------------------------------------------------------------------------
    //   To support persistent login sessions, Passport needs to be able to
    //   serialize users into and deserialize users out of the session.  Typically,
    //   this will be as simple as storing the user ID when serializing, and finding
    //   the user by ID when deserializing.  However, since this example does not
    //   have a database of user records, the complete GitHub profile is serialized
    //   and deserialized.
    passport.serializeUser(function(user, done) {
        done(null, user);
    });
    passport.deserializeUser(function(obj, done) {
        done(null, obj);
    });
    var gitHubTokenToSubset = function (accessToken, refreshToken, profile, done) {
        var subset = {
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
    };
    passport.use(new GitHubStrategy({
        clientID: config.github.clientId,
        clientSecret: config.github.clientSecret,
        callbackURL: config.github.callbackUrl,
        scope: ['user:email'],
        userAgent: 'passport-azure-oss-portal-for-github' // CONSIDER: User agent should be configured.
    }, gitHubTokenToSubset));

    // ----------------------------------------------------------------------------
    // Azure Active Directory Passport session setup.
    // ----------------------------------------------------------------------------
    var aadStrategy = new OIDCStrategy({
        callbackURL: config.activeDirectory.redirectUrl,
        realm: config.activeDirectory.tenantId,
        clientID: config.activeDirectory.clientId,
        clientSecret: config.activeDirectory.clientSecret,
        //oidcIssuer: config.creds.issuer,
        identityMetadata: 'https://login.microsoftonline.com/common/.well-known/openid-configuration',
        skipUserProfile: true,
        responseType: 'id_token code',
        responseMode: 'form_post',
    }, function (iss, sub, profile, accessToken, refreshToken, done) {
        done(null, profile);
    });
    passport.use('azure-active-directory', aadStrategy);

  // ----------------------------------------------------------------------------
  // Expanded OAuth-scope GitHub access for org membership writes.
  // ----------------------------------------------------------------------------
  var expandedGitHubScopeStrategy = new GitHubStrategy({
      clientID: config.github.clientId,
      clientSecret: config.github.clientSecret,
      callbackURL: config.github.callbackUrl + '/increased-scope',
      scope: ['user:email', 'write:org'],
      userAgent: 'passport-azure-oss-portal-for-github' // CONSIDER: User agent should be configured.
    }, gitHubTokenToSubset);

    passport.use('expanded-github-scope', expandedGitHubScopeStrategy);

    app.use(passport.initialize());
    app.use(passport.session());

    return passport;
};
