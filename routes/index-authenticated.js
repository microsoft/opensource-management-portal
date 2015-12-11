//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var async = require('async');
var moment = require('moment');
var utils = require('../utils');
var OpenSourceUserContext = require('../oss');

var linkRoute = require('./link');
var linkedUserRoute = require('./index-linked');

router.use(function (req, res, next) {
    if (req.isAuthenticated()) {
        if (req.user && req.user.github && !req.user.github.id) {
            return next(new Error('Invalid GitHub user information provided by GitHub.'));
        }
        var config = req.app.settings.runtimeConfig;
        var dc = req.app.settings.dataclient;
        var instance = new OpenSourceUserContext(config, dc, req.user, dc.cleanupInTheFuture.redisClient, function (error) {
            req.oss = instance;
            instance.addBreadcrumb(req, 'Organizations');
            return next();
        });
    } else {
        var url = req.originalUrl;
        if (url) {
            if (req.session) {
                req.session.referer = req.originalUrl;
            }
        }
        res.redirect('/auth/github');
    }
});

router.use('/link', linkRoute);

router.get('/', function (req, res, next) {
    var oss = req.oss;
    var link = req.oss.entities.link;
    var dc = req.app.settings.dataclient;
    var config = req.app.settings.runtimeConfig;
    var onboarding = req.query.onboarding !== undefined;
    var allowCaching = onboarding ? false : true;
    if (!link && req.user.azure === undefined) {
        return oss.render(req, res, 'welcome', 'Welcome');
    }
    if (!link && req.user.azure && req.user.azure.oid) {
        return res.redirect('/link');
    }
    // They're changing their corporate identity (rare, often just service accounts)
    if (link && link.aadupn && req.user.azure && req.user.azure.username && req.user.azure.username.toLowerCase() !== link.aadupn.toLowerCase()) {
        return res.redirect('/link/update');
    }
    var twoFactorOff = null;
    var activeOrg = null;
    async.parallel({
        isLinkedUser: function (callback) {
            var link = oss.entities.link;
            callback(null, link && link.ghu ? link : false);
        },
        organizations: function (callback) {
            oss.getMyOrganizations(allowCaching, function (error, orgsUnsorted) {
                if (error) {
                    return callback(error);
                }
                async.sortBy(orgsUnsorted, function (org, cb) {
                    var pri = org.setting('priority') ? org.setting('priority') : 'primary';
                     cb(null, pri + ':' + org.name);
                }, function (error, orgs) {
                    if (error) {
                        return callback(error);
                    }
                    // Needs to piggy-back off of any 'active' user...
                    for (var i = 0; i < orgs.length; i++) {
                        if (orgs[i].membershipStateTemporary == 'active') {
                            activeOrg = orgs[i];
                            break;
                        }
                    }
                    if (activeOrg) {
                        activeOrg.queryUserMultifactorStateOkCached(function (error, ok) {
                            twoFactorOff = ok !== true;
                            callback(null, orgs);
                        });
                    } else {
                        callback(null, orgs);
                    }
                });
            });
        },
        teamsMaintained: function (callback) {
            oss.getMyTeamMemberships('maintainer', callback);
        },
        userTeamMemberships: function (callback) {
            oss.getMyTeamMemberships('all', callback);
        },
        isAdministrator: function (callback) {
            callback(null, false);
            // CONSIDER: Re-implement isAdministrator
            // oss.isAdministrator(callback);
        }
    },
    function (error, results) {
        if (error) {
            return next(error);
        }
        var i;
        var countOfOrgs = results.organizations.length;
        var countOfMemberships = 0;
        if (results.organizations && results.organizations.length) {
            for (i = 0; i < results.organizations.length; i++) {
                if (results.organizations[i].membershipStateTemporary == 'active') {
                    ++countOfMemberships;
                }
            }
        }
        results.countOfOrgs = countOfOrgs;
        results.countOfMemberships = countOfMemberships;
        if (countOfMemberships > 0 && twoFactorOff === false) {
            results.twoFactorOn = true;
        }
        if (results.isAdministrator && results.isAdministrator === true) {
            results.isSudoer = true;
        }
        if (results.twoFactorOff === true) {
            var tempOrgNeedToFix = oss.org();
            console.log('2fa off, security check time');
            return res.redirect(tempOrgNeedToFix.baseUrl + 'security-check');
        }
        if (countOfMemberships === 0 && !onboarding) {
            onboarding = true;
        }
        var render = function (results) {
            var pageTitle = results && results.userOrgMembership === false ? 'My GitHub Account' : config.companyName + ' - Open Source Portal for GitHub';
            oss.render(req, res, 'index', pageTitle, {
                accountInfo: results,
                onboarding: onboarding,
                onboardingPostfixUrl: onboarding === true ? '?onboarding=' + config.companyName : '',
                activeOrgUrl: activeOrg ? activeOrg.baseUrl : '/?',
            });
        };
        var teamsMaintained = results.teamsMaintained;
        if (teamsMaintained && teamsMaintained.length && teamsMaintained.length > 0) {
            var teamsMaintainedHash = {};
            for (i = 0; i < teamsMaintained.length; i++) {
                teamsMaintainedHash[teamsMaintained[i].id] = teamsMaintained[i];
            }
            results.teamsMaintainedHash = teamsMaintainedHash;
            dc.getPendingApprovals(teamsMaintained, function (error, pendingApprovals) {
                if (error) {
                    return next(error);
                }
                results.pendingApprovals = pendingApprovals;
                render(results);
            });
        } else render(results);
    });
});

router.use(linkedUserRoute);

module.exports = router;
