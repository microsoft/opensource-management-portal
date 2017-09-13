//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log", "warn"] }] */

const bodyParser = require('body-parser');
const compression = require('compression');
const debug = require('debug')('oss-initialize');
const favicon = require('serve-favicon');
const path = require('path');
const viewServices = require('ospo-pug-view-services');

const campaign = require('./campaign');
const memory = require('./memory');
const officeHyperlinks = require('./officeHyperlinks');
const rawBodyParser = require('./rawBodyParser');
const uptime = require('./uptime');

module.exports = function initMiddleware(app, express, config, dirname, redisClient, initializationError) {
  config = config || {};
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

  app.set('views', path.join(dirname, 'views'));
  app.set('view engine', 'pug');
  app.set('view cache', false);
  app.disable('x-powered-by');

  app.set('viewServices', viewServices);
  const providers = app.get('providers');
  providers.viewServices = viewServices;

  if (web) {
    const insights = app.settings.providers.insights;
    if (insights) {
      uptime.initialize(insights);
      memory.initialize(insights);
    }

    app.use(favicon(dirname + '/public/favicon.ico'));

    app.use(rawBodyParser);
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(compression());

    app.use(express.static(path.join(dirname, 'public')));

    providers.campaign = campaign(app, config);

    var passport;
    if (!initializationError) {
      if (config.webServer.websiteSku && !config.webServer.allowHttp) {
        app.use(require('./requireSecureAppService'));
      } else if (config.containers && config.containers.deployment) {
        app.enable('trust proxy');
        debug('proxy: trusting reverse proxy');
      }
      app.use(require('./session')(app, config, redisClient));
      try {
        passport = require('./passport-config')(app, config);
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
        require('./onboarding')(app, config);
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
