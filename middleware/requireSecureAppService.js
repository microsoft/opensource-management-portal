//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

// ----------------------------------------------------------------------------
// If this portal is deployed to Azure App Service, let's make sure that they
// are connecting over SSL by validating the load balancer headers. If they are
// not, redirect them. Keys off of WEBSITE_SKU env variable that is injected.
// Also supports an additional expected certificate from the load balancer when
// using custom certificates.
// ----------------------------------------------------------------------------
module.exports = function (req, res, next) {
  var config = req.app.settings.runtimeConfig;
  if (!req.headers['x-arr-ssl']) {
    return next(new Error('No "x-arr-ssl" header, yet this app has been deployed to App Service. Please have an administrator investigate.'));
  }
  var arr = req.headers['x-arr-ssl'];
  var expectedHeaders = [
    '2048|256|C=US, S=Washington, L=Redmond, O=Microsoft Corporation, OU=Microsoft IT, CN=Microsoft IT SSL SHA2|CN=*.azurewebsites.net'
  ];
  if (config.webServer.expectedSslCertificate) {
    expectedHeaders.push(config.webServer.expectedSslCertificate);
  }
  var isLegit = false;
  for (var i = 0; i < expectedHeaders.length; i++) {
    if (arr === expectedHeaders[i]) {
      isLegit = true;
    }
  }
  if (!isLegit) {
    console.warn(`The SSL connection may not be secured via Azure App Service. Please contact the site sponsors to investigate: ${arr}`);
  }

  // We are no longer throwing here as it affects the load balancers.
  // if (isLegit === false) {
    // var err = new Error('The SSL connection may not be secured via Azure App Service. Please contact the site sponsors to investigate.');
    // err.headers = req.headers;
    // err.arrHeader = arr;
    // err.detailed = arr;
    // return next(err);
  // }
  req.app.set('trust proxy', 1);
  next();
};
