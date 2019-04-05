//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

const _ = require('lodash');
import express = require('express');
const router = express.Router();

import async = require('async');

import { ReposAppRequest } from '../transitional';
import { addLinkToRequest, RequireLinkMatchesGitHubSession } from '../middleware/links/';
import { requireAuthenticatedUserOrSignIn, setIdentity } from '../middleware/business/authentication';

const linkRoute = require('./link');
const linkedUserRoute = require('./index-linked');
const linkCleanupRoute = require('./link-cleanup');
const placeholdersRoute = require('./placeholders');
const settingsRoute = require('./settings');
const releasesSpa = require('./releasesSpa');

// - - - Middleware: require that they have a passport - - -
router.use(requireAuthenticatedUserOrSignIn);
// - - - Middleware: set the identities we have authenticated  - - -
router.use(setIdentity);
// - - - Middleware: resolve whether the corporate user has a link - - -
router.use(addLinkToRequest);
// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

router.use('/placeholder', placeholdersRoute);
router.use('/link/cleanup', linkCleanupRoute);
router.use('/link', linkRoute);
router.use('/settings', settingsRoute);
router.use('/releases', releasesSpa);

// Link cleanups and check their signed-in username vs their link
router.use(RequireLinkMatchesGitHubSession);

// Dual-purpose homepage: if not linked, welcome; otherwise, show things
router.get('/', function (req: ReposAppRequest, res, next) {
  const individualContext = req.individualContext;
  const link = individualContext.link;

  const operations = req.app.settings.providers.operations;
  const config = req.app.settings.runtimeConfig;
  const onboarding = req.query.onboarding !== undefined;

  if (!link) {
    if (!individualContext.getGitHubIdentity()) {
      return individualContext.webContext.render({
        view: 'welcome',
        title: 'Welcome',
      });
    }
    return res.redirect('/link');
  }

  // var twoFactorOff = null;
  var warnings = [];
  var activeOrg = null;
  const id = link.thirdPartyId;

  async.parallel({
    isLinkedUser: function (callback) {
      callback(null, link && link.thirdPartyId ? link : false);
    },
    overview: (callback) => {
      if (!id) {
        return callback();
      }
      const uc = operations.getUserContext(id);
      return uc.getAggregatedOverview(callback);
    },
    isAdministrator: function (callback) {
      callback(null, false);
      // legacyUserContext.isAdministrator(callback); // CONSIDER: Re-implement isAdministrator
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
      if (overview && overview.organizations) {
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
        // TODO: This would redirect to the organization /security-check endpoint
        // return res.redirect(tempOrgNeedToFix.baseUrl + 'security-check');
        // FIX: Reinstate two-factor off functionality
      }
      const render = function (results) {
        if (warnings && warnings.length > 0) {
          individualContext.webContext.saveUserAlert(warnings.join(', '), 'Some organizations or memberships could not be loaded', 'danger');
        }
        const pageTitle = results && results.userOrgMembership === false ? 'My GitHub Account' : config.brand.companyName + ' - ' + config.brand.appName;
        individualContext.webContext.render({
          view: 'index',
          title: pageTitle,
          optionalObject: {
            accountInfo: results,
            onboarding: onboarding,
            onboardingPostfixUrl: onboarding === true ? '?onboarding=' + config.brand.companyName : '',
            activeOrgUrl: activeOrg ? activeOrg.baseUrl : '/?',
            getOrg: (orgName) => {
              return operations.getOrganization(orgName);
            },
            groupedAvailableOrganizations: groupedAvailableOrganizations,
          },
        });
      };
      if (overview && overview.teams && overview.teams.maintainer) {
        const maintained = overview.teams.maintainer;
        if (maintained.length > 0) {
          const teamsMaintainedHash = {};
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
