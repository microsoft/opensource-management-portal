//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

module.exports = function configureErrorRoutes(app) {
    app.use(function(req, res, next) {
        var err = new Error('Not Found');
        err.status = 404;
        err.skipLog = true;
        next(err);
    });
    app.use(require('./errorHandler'));
};
