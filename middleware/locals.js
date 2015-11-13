//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var os = require('os');

// ----------------------------------------------------------------------------
// Set local variables that we want every view to share.
// ----------------------------------------------------------------------------
module.exports = function (req, res, next) {
    req.app.locals.correlationId = req.correlationId;
    req.app.locals.serverName = os.hostname();
    req.app.locals.appInsightsKey = req.app.settings.runtimeConfig.applicationInsights.instrumentationKey;

    next();
};
