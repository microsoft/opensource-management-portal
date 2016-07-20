//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var utils = require('../utils');

router.get('/', function (req, res) {
  var oss = req.oss;
  if (!(oss.usernames.azure && oss.usernames.github)) {
    // return next(new Error('You must be signed in to both Active Directory and your GitHub account in order to link your account.'));
    return res.redirect('/');
  }
  if (!req.oss.entities.link) {
    req.oss.render(req, res, 'link', 'Link GitHub with corporate identity');
  } else {
    return res.redirect('/');
  }
});

router.post('/', function (req, res, next) {
  var dc = req.app.settings.dataclient;
  dc.createLinkObjectFromRequest(req, function (createLinkError, linkObject) {
    if (createLinkError) {
      return next(utils.wrapError(createLinkError, 'We had trouble linking your corporate and GitHub accounts.'));
    }
    dc.insertLink(req.user.github.id, linkObject, function (insertError) {
      if (insertError) {
        // There are legacy upgrade scenarios for some users where they already have a
        // link, even though they are already on this page. In that case, we just do
        // a retroactive upsert.
        dc.updateLink(req.user.github.id, linkObject, function (updateLinkError) {
          if (updateLinkError) {
            updateLinkError.original = insertError;
            return next(utils.wrapError(updateLinkError, 'We had trouble storing the corporate identity link information. Please file this issue and we will have an administrator take a look.'));
          }
          return res.redirect('/?onboarding=yes');
        });
      } else {
        return res.redirect('/?onboarding=yes');
      }
    });
  });
});

router.get('/reconnect', function (req, res, next) {
  var config = req.app.settings.runtimeConfig;
  var oss = req.oss;
  if (config.primaryAuthenticationScheme !== 'aad'){
    return next(utils.wrapError(null, 'Account reconnection is only needed for Active Directory authentication applications.', true));
  }
  // If the request comes back to the reconnect page, the authenticated app will
  // actually update the link the next time around.
  if (req.user.github && req.user.github.id || !(oss && oss.entities && oss.entities.link && oss.entities.link.ghu && !oss.entities.link.ghtoken)) {
    return res.redirect('/');
  }
  return oss.render(req, res, 'reconnectGitHub', 'Please sign in with GitHub', {
    expectedUsername: oss.entities.link.ghu,
  });
});

router.get('/update', function (req, res, next) {
  var config = req.app.settings.runtimeConfig;
  var oss = req.oss;
  // TODO: A "change" experience might be slightly different for AAD
  if (config.primaryAuthenticationScheme === 'aad') {
    return next(utils.wrapError(null, 'Changing a GitHub account is not yet supported.', true));
  }
  if (!(oss.usernames.azure)) {
    return oss.render(req, res, 'linkUpdate', 'Update your account ' + oss.usernames.github + ' by signing in with corporate credentials.');
  }
  var dc = req.app.settings.dataclient;
  dc.createLinkObjectFromRequest(req, function (error, linkObject) {
    dc.updateLink(req.user.github.id, linkObject, function (updateLinkError) {
      if (updateLinkError) {
        return next(utils.wrapError(updateLinkError, 'We had trouble updating the link using a data store API.'));
      }
      oss.saveUserAlert(req, 'Your GitHub account is now associated with the corporate identity for ' + linkObject.aadupn + '.', 'Corporate Identity Link Updated', 'success');
      res.redirect('/');
    });
  });
});

module.exports = router;
