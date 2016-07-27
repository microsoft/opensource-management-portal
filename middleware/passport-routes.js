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

  function processSignout(primaryAuthScheme, secondaryAuthProperty, req, res, next) {
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
    if (req.user && req.user[secondaryAuthProperty] !== undefined) {
      delete req.user[secondaryAuthProperty];
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
    console.log('resaving hoist');
    console.dir(clone);
    req.login(clone, callback);
  }

  app.get('/auth/github', ghMiddleware);

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
        title: 'Goodbye',
        buttonText: 'Sign In Again',
        config: initialConfig.obfuscatedConfig,
      });
    }
  });

  app.get('/signout/github', processSignout.bind(null, 'github', 'github'));

  // ----------------------------------------------------------------------------
  // Expanded GitHub auth scope routes
  // ----------------------------------------------------------------------------
  app.get('/signin/github/increased-scope', function (req, res) {
    utils.storeReferrer(req, res, '/auth/github/increased-scope');
  });

  app.get('/auth/github/increased-scope', passport.authorize('expanded-github-scope'));

  // TODO: Validate that the increased scope user ID === the actual user ID

  app.get('/auth/github/callback/increased-scope', 
    passport.authorize('expanded-github-scope'), 
    authenticationCallback.bind(null, 'all', 'githubIncreasedScope'));

  // ----------------------------------------------------------------------------
  // passport integration with Azure Active Directory
  // ----------------------------------------------------------------------------
  var aadMiddleware = initialConfig.authentication.scheme === 'github' ? passport.authorize('azure-active-directory') : passport.authenticate('azure-active-directory');

  app.get('/auth/azure', aadMiddleware);

  app.post('/auth/azure/callback', aadMiddleware, authenticationCallback.bind(null, 'aad', 'azure'));

  app.get('/signin/azure', function (req, res) {
    utils.storeReferrer(req, res, '/auth/azure');
  });

  app.get('/signout/azure', processSignout.bind(null, 'aad', 'azure'));

};
