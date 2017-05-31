//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();

router.use('/data', (req, res) => {
  const exploreUrl = req.app.settings.runtimeConfig.microsoftOpenSource.explore;
  res.redirect(`${exploreUrl}resources/insights`);
});

router.use('/use', (req, res) => {
  const exploreUrl = req.app.settings.runtimeConfig.microsoftOpenSource.explore;
  res.redirect(`${exploreUrl}resources/use`);
});

router.use('/release', (req, res) => {
  const exploreUrl = req.app.settings.runtimeConfig.microsoftOpenSource.explore;
  res.redirect(`${exploreUrl}resources/release`);
});

module.exports = router;
