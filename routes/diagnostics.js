//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();

const redacted = '*****';

router.get('/', (req, res) => {
  let config = req.app.settings.runtimeConfig;
  let safeUserView = {
    cookies: req.cookies,
    sessionId: req.session.id,
    sessionIndex: `${config.redis.prefix}.session:${req.session.id}`,
    user: {},
  };
  if (req.user && req.user.github) {
    let github = {};
    for (let key in req.user.github) {
      let val = req.user.github[key];
      if (key === 'accessToken') {
        val = redacted;
      }
      github[key] = val;
    }
    safeUserView.user.github = github;
  }
  if (req.user && req.user.azure) {
    let azure = {};
    for (let key in req.user.azure) {
      let val = req.user.azure[key];
      if (key === 'accessToken') {
        val = redacted;
      }
      azure[key] = val;
    }
    safeUserView.user.azure = azure;
  }
  for (let key in req.session) {
    if (typeof req.session[key] !== 'object') {
      safeUserView[key] = req.session[key];
    }
  }
  safeUserView.websiteHostname = process.env.WEBSITE_HOSTNAME;
  return res.render('message', {
    message: 'My information',
    messageTiny: 'This information might be useful in helping diagnose issues.',
    messageOutput: JSON.stringify(safeUserView, undefined, 2),
    user: req.user,
    config: config,
    corporateLinks: config.corporate.trainingResources['public-homepage'],
    serviceBanner: config && config.serviceMessage ? config.serviceMessage.banner : undefined,
    title: 'Open Source Portal for GitHub - ' + config.brand.companyName
  });
});

module.exports = router;
