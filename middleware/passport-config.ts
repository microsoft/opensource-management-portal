//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import createAADStrategy from "./passport/aadStrategy";
import createGitHubStrategy from "./passport/githubStrategy";

const passport = require('passport');
const serializer = require('./passport/serializer');


export default function (app, config) {
  const supportedAuth = ['github', 'aad', 'oauth2'];

  if (!supportedAuth.includes(config.authentication.scheme)) {
    throw new Error(`Unsupported primary authentication scheme type "${config.authentication.scheme}"`);
  }

  // Always set up GitHub strategies
  const gitHubStrategies = createGitHubStrategy(app, config);
  for (const name in gitHubStrategies) {
    passport.use(name, gitHubStrategies[name]);
    // Validate and borrow a few parameters from the GitHub passport library, for the default github strategy
    if (name === 'github') {
      // @ts-ignore
      if (githubPassportStrategy._oauth2 && githubPassportStrategy._oauth2._authorizeUrl) {
        // @ts-ignore
        app.set('runtime/passport/github/authorizeUrl', githubPassportStrategy._oauth2._authorizeUrl);
      } else {
        throw new Error('The GitHub Passport strategy library may have been updated, it no longer contains the expected Authorize URL property within the OAuth2 object.');
      }
      // @ts-ignore
      if (githubPassportStrategy._scope && githubPassportStrategy._scopeSeparator) {
        // @ts-ignore
        app.set('runtime/passport/github/scope', githubPassportStrategy._scope.join(githubPassportStrategy._scopeSeparator));
      } else {
        throw new Error('The GitHub Passport strategy library may have been updated, it no longer contains the expected Authorize URL property within the OAuth2 object.');
      }
    }
  }

  if (config.authentication.scheme == 'aad') {
    const aadStrategies = createAADStrategy(app, config);
    for (const name in aadStrategies) {
      passport.use(name, aadStrategies[name]);
    }
  } else if (config.authentication.scheme == 'oauth2') {
    // Set up oauth2 strategy here
  }

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
