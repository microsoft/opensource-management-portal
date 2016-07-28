//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();
const OpenSourceUserContext = require('../oss');

// Enforcing just a single GitHub account per Active Directory user. With
// mild refactoring, this portal could easily support a session selecting
// which link to work with, too.

router.use((req, res, next) => {
  let config = req.app.settings.runtimeConfig;
  if (config.authentication.scheme !== 'aad') {
    return next(new Error('Link cleanup is only supported for certain types of authentication schemes.'));
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

function renderCleanupPage(req, res, idToConfirm, links) {
  links = links || req.linksForCleanup;
  let twoColumns = [[], []];
  for (let i = 0; i < links.length; i++) {
    if (links[i].joined) {
      links[i].joinedDate = new Date(Math.round(links[i].joined));
    }
    twoColumns[i % 2].push(links[i]);
  }
  req.oss.render(req, res, 'multiplegithubaccounts', 'GitHub Cleanup', {
    linksForCleanupByColumn: twoColumns,
    numberToRemove: req.linksForCleanup.length - 1,
    confirming: idToConfirm,
    hideGitHubAccount: true,
  });
}

router.get('/', (req, res) => {
  renderCleanupPage(req, res);
});

router.post('/', (req, res, next) => {
  let id = req.body.unlink;
  let link = null;
  let remainingLinks = [];
  for (let i = 0; i < req.linksForCleanup.length; i++) {
    if (req.linksForCleanup[i].ghid === id) {
      link = req.linksForCleanup[i];
    } else {
      remainingLinks.push(req.linksForCleanup[i]);
    }
  }
  if (!link) {
    return next(new Error(`Could not identify the link for GitHub user ${id}.`));
  }
  let isConfirming = req.body.confirm === id;
  if (!isConfirming) {
    return renderCleanupPage(req, res, id);
  }
  var options = {
    config: req.app.settings.runtimeConfig,
    dataClient: req.app.settings.dataclient,
    redisClient: req.app.settings.dataclient.cleanupInTheFuture.redisClient,
    link: link,
  };
  new OpenSourceUserContext(options, function (contextError, unlinkContext) {
    if (contextError) {
      return next(contextError);
    }
    unlinkContext.modernUser().unlinkAndDrop((unlinkError) => {
      if (unlinkError) {
        return next(unlinkError);
      }
      if (remainingLinks.length > 1) {
        renderCleanupPage(req, res, null, remainingLinks);
      } else {
        req.oss.saveUserAlert(req, link.ghu + ' has been unlinked. You now have just one GitHub account link.', 'Link cleanup complete', 'success');
        res.redirect('/');
      }
    });
  });
});

module.exports = router;
