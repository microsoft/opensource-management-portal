//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';
import passport from 'passport';

import getCompanySpecificDeployment from './companySpecificDeployment.js';

import { createEntraStrategies } from './passport/entra/strategy.js';
import createGithubStrategy from './passport/githubStrategy.js';
import serializer from './passport/serializer.js';
import { CreateError } from '../lib/transitional.js';

import type {
  AppInsightsTelemetryClient,
  IReposApplication,
  ReposAppRequest,
  SiteConfiguration,
} from '../interfaces/index.js';

export default function (
  app: IReposApplication,
  insights: AppInsightsTelemetryClient,
  config: SiteConfiguration
) {
  const supportedAuth = ['aad', 'oauth2', 'entra-id'];

  if (!supportedAuth.includes(config.authentication.scheme)) {
    throw new Error(`Unsupported primary authentication scheme type "${config.authentication.scheme}"`);
  }

  const companySpecific = getCompanySpecificDeployment();
  companySpecific?.passport?.configure(app, config, passport);

  // Always set up GitHub strategies
  const githubStrategies = createGithubStrategy(app, config);
  for (const name in githubStrategies) {
    passport.use(name, githubStrategies[name]);
    // Validate and borrow a few parameters from the GitHub passport library, for the default github strategy
    if (name === 'github') {
      const strategy = githubStrategies[name];
      // @ts-ignore
      if (strategy._oauth2 && strategy._oauth2._authorizeUrl) {
        // @ts-ignore
        app.set('runtime/passport/github/authorizeUrl', strategy._oauth2._authorizeUrl);
      } else {
        throw new Error(
          'The GitHub Passport strategy library may have been updated, it no longer contains the expected Authorize URL property within the OAuth2 object.'
        );
      }
      // @ts-ignore
      if (strategy._scope && strategy._scopeSeparator) {
        // @ts-ignore
        app.set('runtime/passport/github/scope', strategy._scope.join(strategy._scopeSeparator));
      } else {
        throw new Error(
          'The GitHub Passport strategy library may have been updated, it no longer contains the expected Authorize URL property within the OAuth2 object.'
        );
      }
    }
  }

  if (config.authentication.scheme === 'entra-id') {
    const strategies = createEntraStrategies(app, insights, config);
    for (const name in strategies) {
      passport.use(name, strategies[name]);
    }
  }

  if (config.authentication.scheme === 'oauth2') {
    throw CreateError.NotImplemented('oauth2 is no longer implemented');
  }

  app.use(passport.initialize());
  app.use(passport.session());

  const serializerOptions = {
    config,
  };

  passport.serializeUser(serializer.serialize(serializerOptions));
  passport.deserializeUser(serializer.deserialize(serializerOptions));
  serializer.initialize(serializerOptions, app);

  app.use((req: ReposAppRequest, res: Response, next: NextFunction) => {
    const activeContext = req.apiContext || req.individualContext;
    if (
      activeContext?.insights?.commonProperties &&
      config.authentication.scheme === 'aad' &&
      req?.user?.azure?.oid
    ) {
      activeContext.insights.commonProperties.aadId = req.user.azure.oid;
    }
    return next();
  });

  return passport;
}
