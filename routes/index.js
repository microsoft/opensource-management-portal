//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();

router.get('/', function(req, res, next) {
    if (!req.isAuthenticated()) {
        var config = req.app.settings.runtimeConfig;
        return res.render('home', {
            user: req.user,
            config: config,
            corporateLinks: config.corporate.trainingResources['public-homepage'],
            serviceBanner: config && config.serviceBanner ? config.serviceBanner : undefined,
            title: 'Open Source Portal for GitHub - ' + config.companyName});
    }
    next();
});

router.use('/thanks', require('./thanks'));
router.use(require('./microsoft-specific'));

router.use(require('./index-authenticated'));

module.exports = router;
