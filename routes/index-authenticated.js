//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

const express = require('express');
const router = express.Router();
const async = require('async');
const OpenSourceUserContext = require('../oss');
const linkRoute = require('./link');
const linkedUserRoute = require('./index-linked');
const linkCleanupRoute = require('./link-cleanup');
const utils = require('../utils');

router.use(function (req, res, next) {
  var config = req.app.settings.runtimeConfig;
  if (req.isAuthenticated()) {
    var expectedAuthenticationProperty = config.primaryAuthenticationScheme === 'github' ? 'github' : 'azure';
    if (req.user && !req.user[expectedAuthenticationProperty]) {
      console.warn(`A user session was authenticated but did not have present the property ${expectedAuthenticationProperty} expected for this type of authentication. Signing them out.`);
      return res.redirect('/signout');
    }
    var expectedAuthenticationKey = config.primaryAuthenticationScheme === 'github' ? 'id' : 'username';
    if (!req.user[expectedAuthenticationProperty][expectedAuthenticationKey]) {
      return next(new Error('Invalid information present for the authentication provider.'));
    }
    return next();
  }
  utils.storeOriginalUrlAsReferrer(req, res, config.primaryAuthenticationScheme === 'github' ? '/auth/github' : '/auth/azure');
});

router.use((req, res, next) => {
  var options = {
    config: req.app.settings.runtimeConfig,
    dataClient: req.app.settings.dataclient,
    redisClient: req.app.settings.dataclient.cleanupInTheFuture.redisClient,
    request: req,
  };
  new OpenSourceUserContext(options, (error, instance) => {
    req.oss = instance;
    if (error && error.tooManyLinks === true) {
      if (req.url === '/link-cleanup') {
        // The only URL permitted in this state is the cleanup endpoint
        return next();
      }
      return res.redirect('/link-cleanup');
    }
    instance.addBreadcrumb(req, 'Organizations');
    return next(error);
  });
});

router.use('/link-cleanup', linkCleanupRoute);

router.use('/link', linkRoute);

// Link cleanups
router.use((req, res, next) => {
  if (!req.oss || !req.oss.modernUser()) {
    return next();
  }
  var link = req.oss.modernUser().link;
  if (req.user.azure && req.user.azure.oid && link.aadoid && req.user.azure.oid !== link.aadoid) {
    return next(new Error('Directory security identifier mismatch. Please submit a report to have this checked on.'));
  }
  if (req.user.github && req.user.github.id && link.ghid && req.user.github.id !== link.ghid) {
    return next(new Error('GitHub user security identifier mismatch. Please submit a report to have this checked on.'));
  }
  var linkUpdates = {};
  var updatedProperties = new Set();
  var sessionToLinkMap = {
    github: {
      username: 'ghu',
      avatarUrl: 'ghavatar',
      accessToken: 'ghtoken',
    },
    azure: {
      displayName: 'aadname',
      username: 'aadupn',
    },
  };
  for (var sessionKey in sessionToLinkMap) {
    for (var property in sessionToLinkMap[sessionKey]) {
      var linkProperty = sessionToLinkMap[sessionKey][property];
      if (req.user[sessionKey] && req.user[sessionKey][property] && link[linkProperty] !== req.user[sessionKey][property]) {
        linkUpdates[linkProperty] = req.user[sessionKey][property];
        updatedProperties.add(`${sessionKey}.${property}`);
        console.warn(`Link property "${linkProperty}" updated from "${link[linkProperty]}"->"${linkUpdates[linkProperty]}"`);
      }
    }
  }
  if (updatedProperties.has('github.accessToken')) {
    linkUpdates.ghtokenupdated = new Date().getTime();
  }
  if (Object.keys(linkUpdates).length === 0) {
    return next();
  }
  req.oss.modernUser().updateLink(linkUpdates, (mergeError, mergedLink) => {
    if (mergeError) {
      return next(mergeError);
    }
    req.oss.setPropertiesFromLink(mergedLink, () => {
      next();
    });
  });
});

// Ensure we have a GitHub token for AAD users once they are linked. This is
// for users of the portal before the switch to supporting primary authentication
// of a type other than GitHub.
router.use((req, res, next) => {
  if (req.app.settings.runtimeConfig.primaryAuthenticationScheme === 'aad' && req.oss && req.oss.modernUser()) {
    var link = req.oss.modernUser().link;
    if (link && !link.ghtoken) {
      return utils.storeOriginalUrlAsReferrer(req, res, '/link/reconnect');
    }
  }
  next();
});

router.get('/', function (req, res, next) {
  var oss = req.oss;
  var link = req.oss.entities.link;
  var dc = req.app.settings.dataclient;
  var config = req.app.settings.runtimeConfig;
  var onboarding = req.query.onboarding !== undefined;
  var allowCaching = onboarding ? false : true;

  if (!link) {
    if (config.primaryAuthenticationScheme === 'github' && req.user.azure === undefined ||
      config.primaryAuthenticationScheme === 'aad' && req.user.github === undefined) {
      return oss.render(req, res, 'welcome', 'Welcome');
    }
    if (config.primaryAuthenticationScheme === 'github' && req.user.azure && req.user.azure.oid ||
      config.primaryAuthenticationScheme === 'aad' && req.user.github && req.user.github.id) {
      return res.redirect('/link');
    }
    return next(new Error('This account is not yet linked, but a workflow error is preventing further progress. Please report this issue. Thanks.'));
  }

  // They're changing their corporate identity (rare, often just service accounts)
  if (config.primaryAuthenticationScheme === 'github' && link && link.aadupn && req.user.azure && req.user.azure.username && req.user.azure.username.toLowerCase() !== link.aadupn.toLowerCase()) {
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
        return res.redirect(tempOrgNeedToFix.baseUrl + 'security-check');
      }
      if (countOfMemberships === 0 && !onboarding) {
        onboarding = true;
      }
      var render = function (results) {
        var pageTitle = results && results.userOrgMembership === false ? 'My GitHub Account' : config.companyName + ' - ' + config.portalName;
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
