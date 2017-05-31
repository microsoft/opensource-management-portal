//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  var config = req.app.settings.runtimeConfig.obfuscatedConfig;
  res.render('explore', {
    config: config,
    title: 'Explore',
    site: 'explore',
  });
});

router.get('/registration', (req, res) => {
  var config = req.app.settings.runtimeConfig.obfuscatedConfig;
  res.render('explore', {
    config: config,
    title: 'Witness',
    site: 'registration',
  });
});

router.get('/contribute', (req, res) => {
  var config = req.app.settings.runtimeConfig.obfuscatedConfig;
  res.render('explore', {
    config: config,
    title: 'Contribute',
    site: 'contribute',
  });
});

router.get('/data', (req, res) => {
  var config = req.app.settings.runtimeConfig.obfuscatedConfig;
  res.render('explore', {
    config: config,
    title: 'Data',
    site: 'data',
  });
});

module.exports = router;
