//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// ----------------------------------------------------------------------------
// Application Insights integration
// ----------------------------------------------------------------------------
module.exports = function initializeAppInsights(config) {
    if (config.applicationInsights.instrumentationKey) {
      var appInsights = require('applicationinsights');
      appInsights.setup(config.applicationInsights.instrumentationKey).start();
    }
};
