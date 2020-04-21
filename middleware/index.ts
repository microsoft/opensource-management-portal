//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log", "warn"] }] */

import bodyParser from 'body-parser';
import compression from 'compression';
import path from 'path';

const debug = require('debug')('startup');

import { StaticClientApp } from './staticClientApp';
import { StaticSiteFavIcon, StaticSiteAssets } from './staticSiteAssets';
import ConnectSession from './session';
import passportConfig from './passport-config';
import Onboard from './onboarding';
import viewServices from '../lib/pugViewServices';

const campaign = require('./campaign');
const officeHyperlinks = require('./officeHyperlinks');
const rawBodyParser = require('./rawBodyParser');

module.exports = function initMiddleware(app, express, config, dirname, redisClient, initializationError) {
  config = config || {};
  const appDirectory = config && config.typescript && config.typescript.appDirectory ? config.typescript.appDirectory : stripDistFolderName(dirname);
  const providers = app.get('providers');
  if (initializationError) {
    providers.healthCheck.healthy = false;
  }
  const web = !(config.skipModules && config.skipModules.has('web'));
  if (!initializationError) {
    if (!web) {
      /* No web routes */
    } else if (config.containers && config.containers.deployment) {
      console.log('Container deployment: HTTP: listening, HSTS: on');
      app.use(require('./hsts'));
    } else if (config.containers && config.containers.docker) {
      console.log('Docker image: HTTP: listening, HSTS: off');
    } else if (config.webServer.allowHttp) {
      console.warn('WARNING: Development mode (DEBUG_ALLOW_HTTP): HTTP: listening, HSTS: off');
    } else {
      app.use(require('./sslify'));
      app.use(require('./hsts'));
    }
  }

  app.set('views', path.join(appDirectory, 'views'));
  app.set('view engine', 'pug');
  app.set('view cache', false);
  app.disable('x-powered-by');

  app.set('viewServices', viewServices);
  providers.viewServices = viewServices;

  if (web) {
    StaticSiteFavIcon(app);

    app.use(rawBodyParser);
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(compression());

    StaticSiteAssets(app, express);
    StaticClientApp(app, express);

    providers.campaign = campaign(app, config);

    var passport;
    if (!initializationError) {
      if (config.containers && config.containers.deployment) {
        app.enable('trust proxy');
        debug('proxy: trusting reverse proxy');
      }
      app.use(ConnectSession(app, config, providers));
      try {
        passport = passportConfig(app, config);
      } catch (passportError) {
        initializationError = passportError;
      }
    }

    app.use(require('./scrubbedUrl'));
    app.use(require('./logger')(config));
    app.use(require('./locals'));

    if (!initializationError) {
      require('./passport-routes')(app, passport, config);
      if (config.github.organizations.onboarding && config.github.organizations.onboarding.length) {
        debug('Onboarding helper loaded');
        Onboard(app, config);
      }
      app.use(officeHyperlinks);
    }
  }

  if (initializationError) {
    providers.healthCheck.healthy = false;
    throw initializationError;
  } else {
    providers.healthCheck.ready = true; // Ready to accept traffic
  }
};

function stripDistFolderName(dirname: string) {
  // This is a hacky backup for init failure scenarios where the dirname may
  // not actually point at the app root.
  if (dirname.endsWith('dist')) {
    dirname = dirname.replace('\\dist', '');
    dirname = dirname.replace('/dist', '');
  }
  return dirname;
}
