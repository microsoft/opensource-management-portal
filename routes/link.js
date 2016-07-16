//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var utils = require('../utils');

router.get('/', function (req, res, next) {
    var oss = req.oss;
    if (!(oss.usernames.azure && oss.usernames.github)) {
        return next(new Error('You must be signed in to both Active Directory and your GitHub account in order to link your account.'));
    }
    if (!req.oss.entities.link) {
        req.oss.render(req, res, 'link', 'Link GitHub with corporate identity ' + req.oss.usernames.azure);
    } else {
        return res.redirect('/');
    }
});

router.post('/', function (req, res, next) {
    var dc = req.app.settings.dataclient;
    dc.createLinkObjectFromRequest(req, function (error, linkObject, callback) {
        if (error) {
            return next(utils.wrapError(error, 'We had trouble linking your corporate and GitHub accounts.'));
        }
        dc.insertLink(req.user.github.id, linkObject, function (error, result, response) {
            if (error) {
                // There are legacy upgrade scenarios for some users where they already have a
                // link, even though they are already on this page. In that case, we just do
                // a retroactive upsert.
                dc.updateLink(req.user.github.id, linkObject, function (error2) {
                    if (error2) {
                        error2.original = error;
                        return next(utils.wrapError(error2, 'We had trouble storing the corporate identity link information. Please file this issue and we will have an administrator take a look.'));
                    }
                    return res.redirect('/?onboarding=yes');
                });
            } else {
                return res.redirect('/?onboarding=yes');
            }
        });
    });
});

router.get('/update', function (req, res, next) {
    var oss = req.oss;
    if (!(oss.usernames.azure)) {
        return oss.render(req, res, 'linkUpdate', 'Update your account ' + oss.usernames.github + ' by signing in with corporate credentials.');
    }
    var dc = req.app.settings.dataclient;
    dc.createLinkObjectFromRequest(req, function (error, linkObject, callback) {
        dc.updateLink(req.user.github.id, linkObject, function (error) {
            if (error) {
                return next(utils.wrapError(error, 'We had trouble updating the link using a data store API.'));
            }
            oss.saveUserAlert(req, 'Your GitHub account is now associated with the corporate identity for ' + linkObject.aadupn + '.', 'Corporate Identity Link Updated', 'success');
            res.redirect('/');
        });
    });
});

module.exports = router;
