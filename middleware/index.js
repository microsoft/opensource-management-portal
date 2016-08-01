//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

const path = require('path');
const favicon = require('serve-favicon');
const bodyParser = require('body-parser');
const compression = require('compression');

module.exports = function initMiddleware(app, express, config, dirname, redisClient, initializationError) {
  if (!initializationError) {
    if (config.allowHttp) {
      console.warn('WARNING: Allowing HTTP for local debugging');
    } else {
      app.use(require('./sslify'));
      app.use(require('./hsts'));
    }
    require('./appInsights')(app, config);
  }

  app.set('views', path.join(dirname, 'views'));
  app.set('view engine', 'pug');
  app.set('view cache', false);

  app.use(favicon(dirname + '/public/favicon.ico'));

  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(compression());

  app.use(express.static(path.join(dirname, 'public')));

  var passport;
  if (!initializationError) {
    app.use(require('./session')(config, redisClient));
    try {
      passport = require('./passport-config')(app, config);
    } catch (passportError) {
      initializationError = passportError;
    }
  }

  app.use(require('./scrubbedUrl'));
  app.use(require('./logger')(config));
  if (!initializationError && config.websiteSku && !config.allowHttp) {
    app.use(require('./requireSecureAppService'));
  }
  app.use(require('./correlationId'));
  app.use(require('./locals'));

  if (!initializationError) {
    require('./passport-routes')(app, passport, config);
    if (config.onboarding && config.onboarding.length && config.onboarding.length > 0) {
      require('./onboarding')(app, config);
    }
  }

  if (initializationError) {
    throw initializationError;
  }
};
