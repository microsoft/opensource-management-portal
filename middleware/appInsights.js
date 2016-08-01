//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// ----------------------------------------------------------------------------
// Application Insights integration
// ----------------------------------------------------------------------------
module.exports = function initializeAppInsights(app, config) {
  if (config.applicationInsights.instrumentationKey) {
    var appInsights = require('applicationinsights');
    appInsights.setup(config.applicationInsights.instrumentationKey).start();

    app.use((req, res, next) => {
      if (req.headers && req.headers['synthetictest-id'] !== undefined && req.headers['x-ms-user-agent'] !== undefined && req.headers['x-ms-user-agent'].includes('System Center')) {
        return res.status(204).send();
      }
      next();
    });
  }
};
