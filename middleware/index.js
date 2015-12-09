//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var path = require('path');
var favicon = require('serve-favicon');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var compression = require('compression');

module.exports = function initMiddleware(app, express, config, dirname) {
    require('./appInsights')(config);

    app.set('views', path.join(dirname, 'views'));
    app.set('view engine', 'jade');
    app.set('view cache', false);

    app.use(favicon(dirname + '/public/favicon.ico'));

    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(compression());
    app.use(cookieParser());

    app.use(require('./session')(config));
    var passport = require('./passport-config')(app, config);

    app.use(express.static(path.join(dirname, 'public')));

    app.use(require('./scrubbedUrl'));
    app.use(require('./logger'));
    if (process.env.WEBSITE_SKU) {
        app.use(require('./requireSecureAppService'));
    }
    app.use(require('./correlationId'));
    app.use(require('./locals'));

    require('./passport-routes')(app, passport);
    
    if (config.onboarding && config.onboarding.length && config.onboarding.length > 0) {
        require('./onboarding')(app, config);
    }
};
