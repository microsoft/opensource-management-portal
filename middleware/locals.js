//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const os = require('os');

// ----------------------------------------------------------------------------
// Set local variables that we want every view to share.
// ----------------------------------------------------------------------------
module.exports = function (req, res, next) {
  req.app.locals.correlationId = req.correlationId;
  req.app.locals.scrubbedUrl = req.scrubbedUrl;
  req.app.locals.serverAddress = req.hostname;
  req.app.locals.serverName = os.hostname();
  req.app.locals.websiteHostname = process.env.WEBSITE_HOSTNAME;
  req.app.locals.appInsightsKey = req.app.settings && req.app.settings.runtimeConfig && req.app.settings.runtimeConfig.telemetry ? req.app.settings.runtimeConfig.telemetry.applicationInsightsKey : null;
  req.app.locals.googleAnalyticsKey = req.app.settings && req.app.settings.runtimeConfig && req.app.settings.runtimeConfig.telemetry ? req.app.settings.runtimeConfig.telemetry.googleAnalyticsKey : null;
  req.app.locals.viewServices = req.app.settings.viewServices;

  next();
};
