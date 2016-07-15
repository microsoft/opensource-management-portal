//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var async = require('async');
var utils = require('../utils');

router.use(function (req, res, next) {
    var oss = req.oss;
    var memberOfOrgs = [];
    async.each(oss.orgs(), function (o, callback) {
        o.queryUserMembership(false /* no caching */, function (error, result) {
            var state = null;
            if (result && result.state) {
                state = result.state;
            }
            if (state == 'active' || state == 'pending') {
                memberOfOrgs.push(o);
            }
            callback(error);
        });
    }, function (error) {
        if (error) {
            return next(error);
        }
        req.currentOrganizationMemberships = memberOfOrgs;
        next();
    });
});

router.get('/', function (req, res, next) {
    var link = req.oss.entities.link;
    if (link && link.ghu) {
        return req.oss.render(req, res, 'unlink', 'Remove corporate link and organization memberships', {
            orgs: req.currentOrganizationMemberships,
        });
    } else {
        return next('No link could be found.');
    }
});

router.post('/', function (req, res, next) {
    var currentOrganizationMemberships = req.currentOrganizationMemberships;
    async.each(currentOrganizationMemberships, function (org, callback) {
        org.removeUserMembership(function () {
            // CHANGE: We now continue with deletes when one fails. Common
            // failure case is when they have a pending invite, it will live
            // on... which is not ideal.
            callback();
        });
    }, function (error) {
        var dc = req.app.settings.dataclient;
        var oss = req.oss;
        dc.removeLink(oss.id.github, function (error) {
            if (error) {
                return next(utils.wrapError(error, 'You were successfully removed from all of your organizations. However, a minor failure happened during a data housecleaning operation. Double check that you are happy with your current membership status on GitHub.com before continuing. Press Report Bug if you would like this handled for sure.'));
            }
            res.redirect('/signout');
        });
    });
});

module.exports = router;
