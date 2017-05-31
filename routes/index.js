//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();

router.use('/api', require('./api'));
router.use('/thanks', require('./thanks'));
router.use('/myinfo', require('./diagnostics'));
router.use('/explore', require('./explore'));

router.use(require('./index-authenticated'));

module.exports = router;
