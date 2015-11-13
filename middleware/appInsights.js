//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// ----------------------------------------------------------------------------
// Application Insights integration
// ----------------------------------------------------------------------------
module.exports = function initializeAppInsights(config) {
    if (config.applicationInsights.instrumentationKey) {
        var AppInsights = require('applicationinsights');
        var appInsights = new AppInsights({
            instrumentationKey: config.applicationInsights.instrumentationKey
        });
        appInsights.trackAllHttpServerRequests('favicon');
        appInsights.trackAllUncaughtExceptions();
    }
};
