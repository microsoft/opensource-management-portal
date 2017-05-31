//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

const _ = require('lodash');
const express = require('express');
const router = express.Router();
const async = require('async');
const OpenSourceUserContext = require('../lib/context');
const linkRoute = require('./link');
const linkedUserRoute = require('./index-linked');
const linkCleanupRoute = require('./link-cleanup');
const placeholdersRoute = require('./placeholders');
const settingsRoute = require('./settings');
const usernameConsistency = require('../middleware/links/usernameConsistency');
const utils = require('../utils');

router.use(function (req, res, next) {
  var config = req.app.settings.runtimeConfig;
  if (req.isAuthenticated()) {
    var expectedAuthenticationProperty = config.authentication.scheme === 'github' ? 'github' : 'azure';
    if (req.user && !req.user[expectedAuthenticationProperty]) {
      console.warn(`A user session was authenticated but did not have present the property "${expectedAuthenticationProperty}" expected for this type of authentication. Signing them out.`);
      return res.redirect('/signout');
    }
    var expectedAuthenticationKey = config.authentication.scheme === 'github' ? 'id' : 'oid';
    if (!req.user[expectedAuthenticationProperty][expectedAuthenticationKey]) {
      return next(new Error('Invalid information present for the authentication provider.'));
    }
    return next();
  }
  utils.storeOriginalUrlAsReferrer(req, res, config.authentication.scheme === 'github' ? '/auth/github' : '/auth/azure', 'user is not authenticated and needs to authenticate');
});

router.use((req, res, next) => {
  var options = {
    config: req.app.settings.runtimeConfig,
    dataClient: req.app.settings.dataclient,
    redisClient: req.app.settings.dataclient.cleanupInTheFuture.redisClient,
    redisHelper: req.app.settings.redisHelper,
    githubLibrary: req.app.settings.githubLibrary,
    ossDbClient: req.app.settings.ossDbConnection,
    request: req,
    insights: req.insights,
  };
  new OpenSourceUserContext(options, (error, instance) => {
    req.oss = instance;
    if (error && (error.tooManyLinks === true || error.anotherAccount === true)) {
      // The only URL permitted in this state is the cleanup endpoint and special multiple-account endpoint
      if (req.url === '/link/cleanup' || req.url === '/link/enableMultipleAccounts' || req.url.startsWith('/placeholder')) {
        return next();
      }
      return res.redirect('/link/cleanup');
    }
    instance.addBreadcrumb(req, 'Organizations');
    return next(error);
  });
});

router.use('/placeholder', placeholdersRoute);

router.use('/link/cleanup', linkCleanupRoute);

router.use('/link', linkRoute);

router.use('/settings', settingsRoute);

// Link cleanups
router.use(usernameConsistency());

// Ensure we have a GitHub token for AAD users once they are linked. This is
// for users of the portal before the switch to supporting primary authentication
// of a type other than GitHub.
router.use((req, res, next) => {
  if (req.app.settings.runtimeConfig.authentication.scheme === 'aad' && req.oss && req.oss.modernUser()) {
    var link = req.oss.modernUser().link;
    if (link && !link.githubToken) {
      return utils.storeOriginalUrlAsReferrer(req, res, '/link/reconnect', 'no GitHub token or not a link while authenticating inside of index-authenticated.js');
    }
  }
  next();
});

router.get('/', function (req, res, next) {
  const operations = req.app.settings.providers.operations;
  var oss = req.oss;
  var link = req.oss.entities.link;
  var config = req.app.settings.runtimeConfig;
  var onboarding = req.query.onboarding !== undefined;
  // var allowCaching = onboarding ? false : true;

  if (!link) {
    if (config.authentication.scheme === 'github' && req.user.azure === undefined ||
      config.authentication.scheme === 'aad' && req.user.github === undefined) {
      return oss.render(req, res, 'welcome', 'Welcome');
    }
    if (config.authentication.scheme === 'github' && req.user.azure && req.user.azure.oid ||
      config.authentication.scheme === 'aad' && req.user.github && req.user.github.id) {
      return res.redirect('/link');
    }
    return next(new Error('This account is not yet linked, but a workflow error is preventing further progress. Please report this issue. Thanks.'));
  }

  // They're changing their corporate identity (rare, often just service accounts)
  if (config.authentication.scheme === 'github' && link && link.aadupn && req.user.azure && req.user.azure.username && req.user.azure.username.toLowerCase() !== link.aadupn.toLowerCase()) {
    return res.redirect('/link/update');
  }

  // var twoFactorOff = null;
  var warnings = [];
  var activeOrg = null;

  async.parallel({
    isLinkedUser: function (callback) {
      var link = oss.entities.link;
      callback(null, link && link.ghu ? link : false);
    },
    overview: (callback) => {
      const id = oss.id.github;
      if (!id) {
        return callback();
      }
      const uc = operations.getUserContext(id);
      return uc.getAggregatedOverview(callback);
    },
    isAdministrator: function (callback) {
      callback(null, false);
      // oss.isAdministrator(callback); // CONSIDER: Re-implement isAdministrator
    }
  },
    function (error, results) {
      if (error) {
        return next(error);
      }
      const overview = results.overview;
      results.countOfOrgs = operations.organizations.length;
      let groupedAvailableOrganizations = null;

      // results may contains undefined returns because we skip some errors to make sure homepage always load successfully.
      if (overview.organizations) {
        if (overview.organizations.member.length) {
          results.countOfOrgs = overview.organizations.member.length;
          if (overview.organizations.member.length > 0) {
            results.twoFactorOn = true;
            // TODO: How to verify in a world with some mixed 2FA value orgs?
          }
        }
        if (overview.organizations.available) {
          groupedAvailableOrganizations = _.groupBy(operations.getOrganizations(overview.organizations.available), 'priority');
        }
      }

      if (results.isAdministrator && results.isAdministrator === true) {
        results.isSudoer = true;
      }

      if (results.twoFactorOff === true) {
        var tempOrgNeedToFix = oss.org();
        return res.redirect(tempOrgNeedToFix.baseUrl + 'security-check');
      }
      var render = function (results) {
        if (warnings && warnings.length > 0) {
          req.oss.saveUserAlert(req, warnings.join(', '), 'Some organizations or memberships could not be loaded', 'danger');
        }
        var pageTitle = results && results.userOrgMembership === false ? 'My GitHub Account' : config.brand.companyName + ' - ' + config.brand.appName;
        oss.render(req, res, 'index', pageTitle, {
          accountInfo: results,
          onboarding: onboarding,
          onboardingPostfixUrl: onboarding === true ? '?onboarding=' + config.brand.companyName : '',
          activeOrgUrl: activeOrg ? activeOrg.baseUrl : '/?',
          getOrg: (orgName) => {
            return operations.getOrganization(orgName);
          },
          groupedAvailableOrganizations: groupedAvailableOrganizations,
        });
      };
      if (overview.teams && overview.teams.maintainer) {
        const maintained = overview.teams.maintainer;
        if (maintained.length > 0) {
          var teamsMaintainedHash = {};
          maintained.forEach(maintainedTeam => {
            teamsMaintainedHash[maintainedTeam.id] = maintainedTeam;
          });
          results.teamsMaintainedHash = teamsMaintainedHash;
          // dc.getPendingApprovals(teamsMaintained, function (error, pendingApprovals) {
          //   if (error) {
          //     return next(error);
          //   }
          //   results.pendingApprovals = pendingApprovals;
          //   render(results);
          // });
        }
      }
      render(results);
    });
});

router.use(linkedUserRoute);

module.exports = router;
