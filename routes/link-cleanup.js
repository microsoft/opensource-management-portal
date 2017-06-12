//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();
const utils = require('../utils');
const OpenSourceUserContext = require('../lib/context');

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
    req.linksForCleanup = userLinks;
    if (userLinks.length === 1 && req.user && req.user.github && req.user.github.id !== userLinks[0].ghid) {
      if (req.body.unlink && req.body.confirm) {
        return unlink(req, userLinks[0], (unlinkError) => {
          if (unlinkError) {
            next(unlinkError);
          } else {
            res.redirect('/');
          }
        });
      }
      if (req.body.link && req.session.enableMultipleAccounts === true) {
        return link(req, req.body.link, (linkError, linkObject) => {
          if (linkError) {
            next(linkError);
          } else {
            req.session.selectedGithubId = linkObject.ghid;
            res.redirect('/?onboarding=yes');
          }
        });
      }
      return renderChangeAccountPage(req, res, userLinks[0]);
    }
    if (userLinks.length < 2) {
      return res.redirect('/');
    }
    // CONSIDER: Make GitHub user calls to see if these users still exist.
    // EDGE: user renamed their GitHub account... so we may not have their latest GitHub ID, but
    // it would not create a duplicate link since the GHID fields would be the same.
    next();
  });
});

function renderChangeAccountPage(req, res, link) {
  req.legacyUserContext.render(req, res, 'removeothergithubaccount', 'Exiting GitHub account found', {
    link: link,
    confirming: req.body.unlink,
    hideGitHubAccount: true,
    allowAdditionalAccountLink: req.session && req.session.enableMultipleAccounts ? req.session.enableMultipleAccounts : false,
  });
}

function renderCleanupPage(req, res, idToConfirm, links) {
  links = links || req.linksForCleanup;
  let twoColumns = [[], []];
  for (let i = 0; i < links.length; i++) {
    if (links[i].joined) {
      links[i].joinedDate = new Date(Math.round(links[i].joined));
    }
    twoColumns[i % 2].push(links[i]);
  }
  req.legacyUserContext.render(req, res, 'multiplegithubaccounts', 'GitHub Cleanup', {
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
  let action = 'unlink';
  let id = req.body.unlink;
  if (!req.body.unlink && req.session && req.session.enableMultipleAccounts === true && req.body.select) {
    id = req.body.select;
    action = 'select';
  }
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
  if (action === 'select') {
    req.session.selectedGithubId = id;
    return res.redirect('/');
  }
  let isConfirming = req.body.confirm === id;
  if (!isConfirming) {
    return renderCleanupPage(req, res, id);
  }
  unlink(req, link, (unlinkError) => {
    if (unlinkError) {
      return next(unlinkError);
    }
    if (remainingLinks.length > 1) {
      renderCleanupPage(req, res, null, remainingLinks);
    } else {
      req.legacyUserContext.saveUserAlert(req, link.ghu + ' has been unlinked. You now have just one GitHub account link.', 'Link cleanup complete', 'success');
      res.redirect('/');
    }
  });
});

function unlink(req, link, callback) {
  const options = {
    config: req.app.settings.runtimeConfig,
    dataClient: req.app.settings.dataclient,
    redisClient: req.app.settings.dataclient.cleanupInTheFuture.redisClient,
    redisHelper: req.app.settings.redisHelper,
    githubLibrary: req.app.settings.githubLibrary,
    operations: req.app.settings.providers.operations,
    link: link,
    insights: req.insights,
  };
  new OpenSourceUserContext(options, function (contextError, unlinkContext) {
    if (contextError) {
      return callback(contextError);
    }
    unlinkContext.modernUser().unlinkAndDrop(callback);
  });
}

function invalidateCache(req, link, callback) {
  const options = {
    config: req.app.settings.runtimeConfig,
    dataClient: req.app.settings.dataclient,
    redisClient: req.app.settings.dataclient.cleanupInTheFuture.redisClient,
    redisHelper: req.app.settings.redisHelper,
    githubLibrary: req.app.settings.githubLibrary,
    operations: req.app.settings.providers.operations,
    link: link,
    insights: req.insights,
  };
  new OpenSourceUserContext(options, function (contextError, unlinkContext) {
    if (contextError) {
      return callback(contextError);
    }
    unlinkContext.invalidateLinkCache(callback);
  });
}

function link(req, id, callback) {
  const dc = req.app.settings.dataclient;
  dc.createLinkObjectFromRequest(req, function (createLinkError, linkObject) {
    if (createLinkError) {
      return callback(utils.wrapError(createLinkError, `We had trouble linking your corporate and GitHub accounts: ${createLinkError.message}`));
    }
    dc.insertLink(req.user.github.id, linkObject, function (insertError) {
      req.insights.trackEvent('PortalUserLinkAdditionalAccount');
      if (insertError) {
        return callback(insertError);
      }
      invalidateCache(req, linkObject, () => {
        callback(null, linkObject);
      });
    });
  });
}

module.exports = router;
