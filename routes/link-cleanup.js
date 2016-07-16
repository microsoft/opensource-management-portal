//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();
const async = require('async');
const moment = require('moment');
const utils = require('../utils');

// Enforcing just a single GitHub account per Active Directory user. With
// mild refactoring, this portal could easily support a session selecting
// which link to work with, too.

router.use((req, res, next) => {
  let config = req.app.settings.runtimeConfig;
  if (config.primaryAuthenticationScheme !== 'aad') {
    return next(new Error('Link cleanup is only supported for certain types of authentication schemes.'))
  }

  let dc = req.app.settings.dataclient;
  dc.getUserByAadUpn(req.user.azure.username, function (findError, userLinks) {
    if (findError) {
      return next(new Error('Link cleanup is not available.'));
    }
    if (userLinks.length < 2) {
      return res.redirect('/');
    }
    // CONSIDER: Make GitHub user calls to see if these users still exist.
    // EDGE: user renamed their GitHub account... so we may not have their latest GitHub ID, but
    // it would not create a duplicate link since the GHID fields would be the same.
    req.linksForCleanup = userLinks;
    next();
  });
});

router.get('/', (req, res, next) => {
  let twoColumns = [[], []];
  for (let i = 0; i < req.linksForCleanup.length; i++) {
    if (req.linksForCleanup[i].joined) {
      req.linksForCleanup[i].joinedDate = new Date(Math.round(req.linksForCleanup[i].joined));
    }
    twoColumns[i % 2].push(req.linksForCleanup[i]);
  }
  req.oss.render(req, res, 'multiplegithubaccounts', 'GitHub Cleanup', {
    linksForCleanupByColumn: twoColumns,
    numberToRemove: req.linksForCleanup.length - 1,
  })
});

router.post('/', (req, res, next) => {
  next(new Error('tbi'));
});

/*        var link = userLinks[0];
        self.usernames.github = link.ghu;
        self.id.github = link.ghid.toString();
        self.createModernUser(self.id.github, self.usernames.github);
        self.entities.link = link;
        self.modernUser().link = link;
        */

module.exports = router;
