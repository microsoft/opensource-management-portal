//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log", "warn"] }] */

const debug = require('debug')('oss-initialize');
const path = require('path');
const favicon = require('serve-favicon');
const bodyParser = require('body-parser');
const compression = require('compression');
const memory = require('./memory');
const officeHyperlinks = require('./officeHyperlinks');
const rawBodyParser = require('./rawBodyParser');
const uptime = require('./uptime');
const viewServices = require('ospo-pug-view-services');

module.exports = function initMiddleware(app, express, config, dirname, redisClient, initializationError) {
  config = config || {};
  const web = !(config.skipModules && config.skipModules.has('web'));
  if (!initializationError) {
    if (!web) {
      /* No web routes */
    } else if (config.webServer.allowHttp) {
      console.warn('WARNING: Allowing HTTP for local debugging');
    } else {
      app.use(require('./sslify'));
      app.use(require('./hsts'));
    }
  }

  app.set('views', path.join(dirname, 'views'));
  app.set('view engine', 'pug');
  app.set('view cache', false);

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
    app.use('/client/dist', express.static(path.join(dirname, 'client/dist')));

    var passport;
    if (!initializationError) {
      if (config.webServer.websiteSku && !config.webServer.allowHttp) {
        app.use(require('./requireSecureAppService'));
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
      require(officeHyperlinks);
    }
  }

  if (initializationError) {
    throw initializationError;
  }
};
