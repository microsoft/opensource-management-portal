//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import bodyParser from 'body-parser';
import compression from 'compression';
import path from 'path';
import { Express } from 'express';
import passport from 'passport';

import Debug from 'debug';
const debug = Debug.debug('startup');

export * from './react.js';
export * from './business/links.js';
export * from './business/index.js';
export * from './jsonError.js';

import { hasStaticReactClientApp, stripDistFolderName } from '../lib/transitional.js';
import { serveFrontendAppWithAssets } from './staticClientApp.js';
import { configureStaticAssetHosting } from './staticSiteAssets.js';
import connectSession from './session.js';
import passportConfig from './passportConfig.js';
import onboard from './onboarding.js';

import campaign from './campaign.js';
import { codespacesDevAssistant } from './codespaces.js';
import officeHyperlinks from './officeHyperlinks.js';
import rawBodyParser from './rawBodyParser.js';

import routeScrubbedUrl from './scrubbedUrl.js';
import routeLogger from './logger.js';
import routeLocals from './locals.js';
import routePassport from './passport-routes.js';

import type { IProviders, IReposApplication, SiteConfiguration } from '../interfaces/index.js';
import type { ExpressWithStatic } from './types.js';

export default async function initMiddleware(
  app: IReposApplication,
  express: Express,
  providers: IProviders,
  config: SiteConfiguration,
  dirname: string,
  hasCustomRoutes: boolean,
  initializationError: Error
) {
  config = config || ({} as SiteConfiguration);
  const appDirectory =
    config && config.typescript && config.typescript.appDirectory
      ? config.typescript.appDirectory
      : stripDistFolderName(dirname);
  const applicationProfile = providers.applicationProfile;
  if (initializationError) {
    providers.healthCheck.healthy = false;
  }

  app.set('views', path.join(appDirectory, 'views'));
  app.set('view engine', 'pug');

  app.set('view cache', config.node.isProduction);
  app.disable('x-powered-by');

  app.set('viewServices', providers.viewServices);

  if (applicationProfile.webServer) {
    const expressWithStatic = express as ExpressWithStatic;
    const statics = await configureStaticAssetHosting(app, expressWithStatic);
    statics.serveFavoriteIcon();
    app.use(rawBodyParser);
    const defaultBodyParser = bodyParser.json();
    app.use((req, res, next) => {
      // API routes in the main app deployment use a different body parser
      if (!hasCustomRoutes) {
        const isApiPath = req.path?.startsWith('/api/');
        return isApiPath ? next() : defaultBodyParser(req, res, next);
      } else {
        return defaultBodyParser(req, res, next);
      }
    });
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(compression());
    if (!config.node.isProduction && config.github.codespaces.connected) {
      app.use(codespacesDevAssistant);
    }
    if (applicationProfile.serveStaticAssets) {
      statics.serveStaticAssets();
    }
    if (applicationProfile.serveClientAssets && hasStaticReactClientApp()) {
      serveFrontendAppWithAssets(app, expressWithStatic, config);
    }
    providers.campaign = campaign(app);
    let passport: passport.PassportStatic;
    if (!initializationError) {
      if (config.containers && config.containers.deployment) {
        app.enable('trust proxy');
        debug('proxy: trusting reverse proxy');
      }
      if (!hasCustomRoutes) {
        const routeApi = await import('../api/index.js');
        app.use('/api', /* will provide own body parser */ routeApi.default(config));
      }
      if (applicationProfile.sessions) {
        app.use(await connectSession(app, config, providers));
        try {
          passport = passportConfig(app, config);
        } catch (passportError) {
          initializationError = passportError;
        }
      }
    }
    app.use(routeScrubbedUrl);
    app.use(routeLogger(config));
    app.use(routeLocals);
    if (!initializationError) {
      if (applicationProfile.sessions) {
        routePassport(app, passport, config);
        if (config?.github?.organizations?.onboarding?.length > 0) {
          debug('Onboarding helper loaded');
          onboard(app, config);
        }
      }
      app.use(officeHyperlinks);
    }
  }
  if (initializationError) {
    providers.healthCheck.healthy = false;
    throw initializationError;
  } else {
    // Ready to accept traffic
    providers.healthCheck.ready = true;
  }
}
