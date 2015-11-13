//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// ----------------------------------------------------------------------------
// If this portal is deployed to Azure App Service, let's make sure that they
// are connecting over SSL by validating the load balancer headers. If they are
// not, redirect them. Keys off of WEBSITE_SKU env variable that is injected.
// ----------------------------------------------------------------------------
module.exports = function (req, res, next) {
    if (!req.headers['x-arr-ssl']) {
        return res.redirect('https://' + req.headers.host + req.originalUrl);
    } else {
        var arr = req.headers['x-arr-ssl'];
        var expectedHeaders = [
            '2048|128|C=US, S=Washington, L=Redmond, O=Microsoft Corporation, OU=Microsoft IT, CN=Microsoft IT SSL SHA2|CN=*.azurewebsites.net',
            '2048|256|C=US, S=Washington, L=Redmond, O=Microsoft Corporation, OU=Microsoft IT, CN=Microsoft IT SSL SHA2|CN=*.azurewebsites.net'
        ];
        var isLegit = false;
        for (var i = 0; i < expectedHeaders.length; i++) {
            if (arr === expectedHeaders[i]) {
                isLegit = true;
            }
        }
        if (isLegit === false) {
            var err = new Error('The SSL connection may not be secured via Azure App Service. Please contact the site sponsors to investigate.');
            err.headers = req.headers;
            err.arrHeader = arr;
            return next(err);
        }
    }
    next();
};
