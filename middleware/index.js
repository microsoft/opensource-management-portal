//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const path = require('path');
const favicon = require('serve-favicon');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const compression = require('compression');

module.exports = function initMiddleware(app, express, config, dirname, redisClient, initializationError) {
    if (!initializationError) {
        app.use(require('./hsts'));
        require('./appInsights')(config);
    }

    app.set('views', path.join(dirname, 'views'));
    app.set('view engine', 'jade');
    app.set('view cache', false);

    app.use(favicon(dirname + '/public/favicon.ico'));

    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(compression());
    app.use(cookieParser());

    var passport;
    if (!initializationError) {
      app.use(require('./session')(config, redisClient));
      try {
        passport = require('./passport-config')(app, config);
      } catch (passportError) {
        initializationError = passportError;
      }
    }

    app.use(express.static(path.join(dirname, 'public')));

    app.use(require('./scrubbedUrl'));
    app.use(require('./logger'));
    if (!initializationError && process.env.WEBSITE_SKU) {
        app.use(require('./requireSecureAppService'));
    }
    app.use(require('./correlationId'));
    app.use(require('./locals'));

    if (!initializationError) {
        require('./passport-routes')(app, passport);
        if (config.onboarding && config.onboarding.length && config.onboarding.length > 0) {
            require('./onboarding')(app, config);
        }
    }
};
