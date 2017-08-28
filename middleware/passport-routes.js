//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const querystring = require('querystring');
const utils = require('../utils');

module.exports = function configurePassport(app, passport, initialConfig) {
  app.get('/signin', function (req, res) {
    utils.storeReferrer(req, res, '/auth/azure', 'signin page hit, need to go authenticate');
  });

  // ----------------------------------------------------------------------------
  // passport integration with GitHub
  // ----------------------------------------------------------------------------
  app.get('/signin/github', function (req, res) {
    utils.storeReferrer(req, res, '/auth/github', '/signin/github authentication page requested');
  });

  var ghMiddleware = passport.authorize('github');
  const githubFailureRoute = {
    failureRedirect: '/auth/github/',
  };
  var ghMiddlewareWithFailure = passport.authorize('github', githubFailureRoute);

  function authenticationCallback(secondaryAuthScheme, secondaryAuthProperty, req, res, next) {
    const after = (req, res) => utils.redirectToReferrer(req, res, '/', `authentication callback of type ${secondaryAuthScheme} and property ${secondaryAuthProperty}`);
    if (initialConfig.authentication.scheme !== secondaryAuthScheme) {
      return hoistAccountToSession(req, req.account, secondaryAuthProperty, (error) => {
        return error ? next(error) : after(req, res);
      });
    }
    return after(req, res);
  }

  function processSignout(primaryAuthScheme, secondaryAuthProperties, req, res, next) {
    if (initialConfig.authentication.scheme === primaryAuthScheme) {
      return res.redirect('/signout');
    }
    const after = (req, res) => {
      var url = req.headers.referer || '/';
      if (req.query.redirect === 'github') {
        url = 'https://github.com/logout';
      }
      res.redirect(url);
    };
    const secondaryProperties = secondaryAuthProperties.split(',');
    let dirty = false;
    secondaryProperties.forEach((propertyName) => {
      if (req.user && req.user[propertyName] !== undefined) {
        delete req.user[propertyName];
        dirty = true;
      }
    });
    if (dirty) {
      return resaveUser(req, (error) => {
        return error ? next(error) : after(req, res);
      });
    }
    return after(req, res);
  }

  // User-beware, I should not be writing my own truncating shallow object copy code
  function shallowTruncatingCopy(obj) {
    let o = {};
    for (const entity in obj) {
      const value = obj[entity];
      if (typeof value === 'object') {
        o[entity] = {};
        for (const property in value) {
          if (typeof value[property] !== 'object') {
            o[entity][property] = value[property];
          }
        }
      } else {
        o[entity] = value;
      }
    }
    return o;
  }

  function hoistAccountToSession(req, account, property, callback) {
    const serializer = req.app._sessionSerializer;
    const entity = account[property];
    if (entity === undefined) {
      return callback(new Error(`No entity available with the property ${property} to be hoisted.`));
    }
    if (serializer === undefined) {
      req.user[property] = entity;
      return callback();
    }
    const clone = shallowTruncatingCopy(req.user);
    clone[property] = entity;
    resaveUser(req, clone, callback);
  }

  function resaveUser(req, clone, callback) {
    if (typeof clone === 'function') {
      callback = clone;
      clone = undefined;
    }
    if (clone === undefined) {
      clone = shallowTruncatingCopy(req.user);
    }
    req.login(clone, callback);
  }

  app.get('/auth/github', ghMiddleware);

  app.get('/auth/github/callback', ghMiddlewareWithFailure, authenticationCallback.bind(null, 'github', 'github'));

  if (initialConfig.authentication.scheme === 'aad') {
    app.get('/signin/github/join', (req, res) => {
      res.render('creategithubaccount', {
        title: 'Create a GitHub account',
        user: req.user,
        config: initialConfig.obfuscatedConfig,
      });
    });

    app.get('/auth/github/join', (req, res) => {
      var config = req.app.settings.runtimeConfig;
      var authorizeRelativeUrl = req.app.settings['runtime/passport/github/authorizeUrl'].replace('https://github.com', '');
      var joinUrl = 'https://github.com/join?' + querystring.stringify({
        return_to: `${authorizeRelativeUrl}?` + querystring.stringify({
          client_id: config.github.oauth2.clientId,
          redirect_uri: config.github.oauth2.callbackUrl,
          response_type: 'code',
          scope: req.app.settings['runtime/passport/github/scope'],
        }),
        source: 'oauth',
      });
      res.redirect(joinUrl);
    });
  }

  app.get('/signout', function (req, res) {
    var config = req.app.settings.runtimeConfig;
    req.logout();
    if (req.session) {
      delete req.session.enableMultipleAccounts;
      delete req.session.selectedGithubId;
    }
    if (config.authentication.scheme === 'github') {
      res.redirect('https://github.com/logout');
    } else {
      var unlinked = req.query.unlink !== undefined;
      res.render('message', {
        message: unlinked ? `Your ${config.brand.companyName} and GitHub accounts have been unlinked. You no longer have access to any ${config.brand.companyName} organizations, and you have been signed out of this portal.` : 'Goodbye',
        title: 'Goodbye',
        buttonText: unlinked ? 'Re-link' : 'Sign In',
        config: initialConfig.obfuscatedConfig,
      });
    }
  });

  app.get('/signout/github', processSignout.bind(null, 'github', 'github,githubIncreasedScope'));

  // ----------------------------------------------------------------------------
  // Expanded GitHub auth scope routes
  // ----------------------------------------------------------------------------
  app.get('/signin/github/increased-scope', function (req, res) {
    utils.storeReferrer(req, res, '/auth/github/increased-scope', 'request for the /signin/github/increased-scope page to go auth with more GitHub scope');
  });

  app.get('/auth/github/increased-scope', passport.authorize('expanded-github-scope'));

  // TODO: Validate that the increased scope user ID === the actual user ID

  app.get('/auth/github/callback/increased-scope',
    passport.authorize('expanded-github-scope', {
      failureRedirect: '/auth/github/increased-scope',
    }),
    authenticationCallback.bind(null, 'all', 'githubIncreasedScope'));

  // ----------------------------------------------------------------------------
  // passport integration with Azure Active Directory
  // ----------------------------------------------------------------------------
  var aadMiddleware = initialConfig.authentication.scheme === 'github' ? passport.authorize('azure-active-directory') : passport.authenticate('azure-active-directory');

  app.get('/auth/azure', aadMiddleware);

  app.post('/auth/azure/callback', aadMiddleware, authenticationCallback.bind(null, 'aad', 'azure'));

  // HTTP GET at the callback URL is used for a warning for certain users who launch
  // links from apps that temporarily prevent sessions. Technically this seems to
  // impact Windows users who use Word to open links to the site. Collecting
  // telemetry for now.
  app.get('/auth/azure/callback', (req, res, next) => {
    const insights = req.app.settings.providers.insights;
    const isAuthenticated = req.isAuthenticated();
    if (insights) {
      insights.trackEvent('PassportAzureADFailureInvalidStateFailure', {
        requestType: 'HTTP GET',
        originalUrl: req.originalUrl,
        isAuthenticated: isAuthenticated,
      });
    }
    const messageError = new Error(
      isAuthenticated ? 'Authentication initially failed, but you are good to go now.' : 'Authentication failed, possibly due to a state problem. This can happen when certain tools or apps launch URLs. Try signing in again now.');
    if (isAuthenticated) {
      messageError.skipOops = true;
      messageError.detailed = 'Unfortunately we were not able to take you to the URL that you clicked on. If you go to that URL now, your request should work!';
      messageError.fancyLink = {
        link: '/',
        title: 'Go to the site homepage',
      };
    } else {
      messageError.fancyLink = {
        link: '/auth/azure',
        title: 'Try signing in again',
      };
    }
    return next(messageError);
  });

  app.get('/signin/azure', function (req, res) {
    utils.storeReferrer(req, res, '/auth/azure', 'request for the /signin/azure page, need to authenticate');
  });

  app.get('/signout/azure', processSignout.bind(null, 'aad', 'azure'));

};
