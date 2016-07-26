//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const querystring = require('querystring');
const utils = require('../utils');

module.exports = function configurePassport(app, passport, initialConfig) {
  app.get('/signin', function (req, res) {
    utils.storeReferrer(req, res, initialConfig.authentication.scheme === 'github' ? '/auth/github' : '/auth/azure');
  });

  // ----------------------------------------------------------------------------
  // passport integration with GitHub
  // ----------------------------------------------------------------------------
  app.get('/signin/github', function (req, res) {
    utils.storeReferrer(req, res, '/auth/github');
  });

  var ghMiddleware = initialConfig.authentication.scheme === 'github' ? passport.authenticate('github') : passport.authorize('github');

  function authenticationCallback(secondaryAuthScheme, secondaryAuthProperty, req, res, next) {
    const after = (req, res) => utils.redirectToReferrer(req, res);
    if (initialConfig.authentication.scheme !== secondaryAuthScheme) {
      return hoistAccountToSession(req, req.account, secondaryAuthProperty, (error) => {
        return error ? next(error) : after(req, res);
      });
    }
    return after(req, res);
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
    console.log('hoisting with a serializer');
    console.dir(req.session);
    return callback(new Error('not implemented'));
  }

  app.get('/auth/github', ghMiddleware);

  /*app.get('/auth/github/callback', ghMiddleware, (req, res) => {
    if (initialConfig.authentication.scheme !== 'github') {
      hoistAccountToSession(req.app, req.account, 'github');
    }
    utils.redirectToReferrer(req, res);
  });*/

  app.get('/auth/github/callback', ghMiddleware, authenticationCallback.bind(null, 'github', 'github'));

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
          client_id: config.github.clientId,
          redirect_uri: config.github.callbackUrl,
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

    if (config.authentication.scheme === 'github') {
      res.redirect('https://github.com/logout');
    } else {
      res.render('message', {
        messageTitle: 'Goodbye',
        message: 'You have been signed out.',
        buttonText: 'Sign In Again',
        config: initialConfig.obfuscatedConfig,
      });
    }
  });

  app.get('/signout/github', function (req, res) {
    if (req.app.settings.runtimeConfig.authentication.scheme === 'github') {
      return res.redirect('/signout');
    }
    if (req.user && req.user.github) {
      delete req.user.github;
    }
    var url = req.headers.referer || '/';
    if (req.query.redirect === 'github') {
      url = 'https://github.com/logout';
    }
    res.redirect(url);
  });

  // ----------------------------------------------------------------------------
  // Expanded GitHub auth scope routes
  // ----------------------------------------------------------------------------
  app.get('/signin/github/increased-scope', function (req, res) {
    utils.storeReferrer(req, res, '/auth/github/increased-scope');
  });

  // TODO: xxx
  app.get('/auth/github/increased-scope', passport.authorize('expanded-github-scope'));

  // TODO: xxx
  app.get('/auth/github/callback/increased-scope',
    passport.authorize('expanded-github-scope'), function (req, res) {
      var account = req.account;
      var user = req.user;
      user.github.increasedScope = account;
      utils.redirectToReferrer(req, res);
    });

  // ----------------------------------------------------------------------------
  // passport integration with Azure Active Directory
  // ----------------------------------------------------------------------------
  var aadMiddleware = initialConfig.authentication.scheme === 'github' ? passport.authorize('azure-active-directory') : passport.authenticate('azure-active-directory');

  app.get('/auth/azure', aadMiddleware);

  app.post('/auth/azure/callback', aadMiddleware, authenticationCallback.bind(null, 'aad', 'azure'));

  /*  (req, res, next) => {
    const after = (req, res) => utils.redirectToReferrer(req, res);
    if (initialConfig.authentication.scheme !== 'aad') {
      return hoistAccountToSession(req.app, req.account, 'azure', (error) => {
        return error ? next(error) : after(req, res);
      });
    }
    return after(req, res);
  });*/

  app.get('/signin/azure', function (req, res) {
    utils.storeReferrer(req, res, '/auth/azure');
  });

  app.get('/signout/azure', function (req, res) {
    if (req.app.settings.runtimeConfig.authentication.scheme === 'aad') {
      return res.redirect('/signout');
    }
    if (req.user && req.user.azure) {
      delete req.user.azure;
    }
    res.redirect('/');
  });
};
