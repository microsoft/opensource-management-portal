//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import _ from 'lodash';

import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import { hasStaticReactClientApp, getProviders, CreateError } from '../lib/transitional.js';
import { Organization } from '../business/organization.js';

import {
  tryAddLinkToRequest,
  injectReactClient,
  requireAccessTokenClient,
  requireAuthenticatedUserOrSignIn,
  RequireLinkMatchesGitHubSessionExceptPrefixedRoute,
  setIdentity,
} from '../middleware/index.js';
import { blockEnterpriseManagedUsersAuthentication } from '../middleware/github/blockEnterpriseManagedUsers.js';

import routeApprovals from './approvals.js';
import routeExplore from './explore.js';
import routeLink from './link.js';
import routeLinkedUserRoutes from './index-linked.js';
import routeLinkCleanup from './link-cleanup.js';
import routePlaceholders from './placeholders.js';
import routeSettings from './settings/index.js';

import getCompanySpecificDeployment from '../middleware/companySpecificDeployment.js';

const hasReactApp = hasStaticReactClientApp();
const reactFrontend = hasReactApp ? injectReactClient() : undefined;

import { ReposAppRequest, UserAlertType } from '../interfaces/index.js';
import { Repository } from '../business/index.js';

// - - - Middleware: require that they have a passport - - -
router.use(requireAuthenticatedUserOrSignIn);
router.use(requireAccessTokenClient);
// - - - Middleware: set the identities we have authenticated  - - -
router.use(setIdentity);
// - - - Middleware: resolve whether the corporate user has a link - - -
router.use(tryAddLinkToRequest);
// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

router.use(blockEnterpriseManagedUsersAuthentication);

router.use('/approvals', reactFrontend || routeApprovals);
router.use('/explore', reactFrontend || routeExplore);
router.use('/link', reactFrontend || routeLink);
router.use('/link/cleanup', reactFrontend || routeLinkCleanup);
router.use('/placeholder', routePlaceholders);

if (reactFrontend) {
  // client-only routes
  router.use('/releases', reactFrontend);
  router.use('/support', reactFrontend);
  router.use('/use', reactFrontend);
  router.use('/release', reactFrontend);
  router.use('/unlock', reactFrontend);
  router.use('/enable', reactFrontend);
  router.use('/new', reactFrontend);
  router.use('/news', reactFrontend); // intercept early
}

const dynamicStartupInstance = getCompanySpecificDeployment();
if (dynamicStartupInstance?.routes?.connectAuthenticatedRoutes) {
  dynamicStartupInstance.routes.connectAuthenticatedRoutes(router, reactFrontend);
}

router.use('/settings', reactFrontend || routeSettings);

router.get('/news', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const config = getProviders(req).config;
  if (config && config.news && config.news.all && config.news.all.length) {
    return req.individualContext.webContext.render({
      view: 'news',
      title: "What's New",
    });
  } else {
    return next(); // only attach this route if there are any static stories
  }
});

router.use('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  // Helper method to allow pasting a GitHub URL into the app to go to a repo
  const { rid, oid, action } = req.query;
  const { operations } = getProviders(req);
  if (!rid && !oid) {
    return next();
  }
  const repositoryId = Number(rid);
  const organizationId = Number(oid);
  let organization: Organization = null;
  let repository: Repository = null;
  try {
    organization = operations.getOrganizationById(organizationId);
  } catch (error) {
    // no-op continue
    return next();
  }
  if (organization) {
    try {
      repository = await organization.getRepositoryById(repositoryId);
      return res.redirect(`/orgs/${organization.name}/repos/${repository.name}${action ? `/${action}` : ''}`);
    } catch (error) {
      // no-op continue
      return next();
    }
  }
  return next();
});

// Link cleanups and check their signed-in username vs their link
router.use(RequireLinkMatchesGitHubSessionExceptPrefixedRoute('/unlink'));

// Dual-purpose homepage: if not linked, welcome; otherwise, show things
router.get(
  '/',
  reactFrontend ||
    async function (req: ReposAppRequest, res: Response, next: NextFunction) {
      const onboarding = req.query.onboarding !== undefined;
      const individualContext = req.individualContext;
      const link = individualContext.link;
      const providers = getProviders(req);
      const operations = providers.operations;
      const config = getProviders(req).config;
      if (!link) {
        if (!individualContext.getGitHubIdentity()) {
          return individualContext.webContext.render({
            view: 'welcome',
            title: 'Welcome',
          });
        }
        return res.redirect('/link');
      }
      const warnings = [];
      const activeOrg = null;
      const id = link.thirdPartyId;
      const results = {
        isLinkedUser: link && link.thirdPartyId ? link : false,
        overview: id ? await individualContext.aggregations.getAggregatedOverview() : null,
        isAdministrator: false, // legacyUserContext.isAdministrator(callback); // CONSIDER: Re-implement isAdministrator
        // TODO: bring back sudoers
        countOfOrgs: operations.organizations.size,
        twoFactorOn: null,
        isSudoer: null,
        twoFactorOff: false, // TODO: RESTORE: Reinstate two-factor off functionality
        teamsMaintainedHash: null,
        userOrgMembership: null,
      };
      let groupedAvailableOrganizations = null;
      const overview = results.overview;
      // results may contains undefined returns because we skip some errors to make sure homepage always load successfully.
      if (overview && overview.organizations) {
        if (overview.organizations.member.length) {
          results.countOfOrgs = overview.organizations.member.length;
          if (overview.organizations.member.length > 0) {
            results.twoFactorOn = true;
            // ANTIQUATED: How to verify in a world with some mixed 2FA value orgs?
            // NOTE: 2FA org settings can now be determined in the org details body
          }
        }
        if (overview.organizations.available) {
          const availableNames = overview.organizations.available.map((org: Organization) => {
            return org.name;
          });
          groupedAvailableOrganizations = _.groupBy(operations.getOrganizations(availableNames), 'priority');
        }
      }
      if (results.isAdministrator && results.isAdministrator === true) {
        results.isSudoer = true;
      }
      if (results.twoFactorOff === true) {
        // Now that GitHub enforces 2FA at join time, a non-compliant user will get warned while joining, natively.
        // TODO: This would redirect to the organization /security-check endpoint
        // return res.redirect(tempOrgNeedToFix.baseUrl + 'security-check');
      }
      if (overview && overview.teams && overview.teams.maintainer) {
        const maintained = overview.teams.maintainer;
        if (maintained.length > 0) {
          const teamsMaintainedHash = {};
          maintained.forEach((maintainedTeam) => {
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
      if (warnings && warnings.length > 0) {
        individualContext.webContext.saveUserAlert(
          warnings.join(', '),
          'Some organizations or memberships could not be loaded',
          UserAlertType.Danger
        );
      }
      const pageTitle =
        results && results.userOrgMembership === false
          ? 'My GitHub Account'
          : config.brand.companyName + ' - ' + config.brand.appName;
      individualContext.webContext.render({
        view: 'index',
        title: pageTitle,
        optionalObject: {
          accountInfo: results,
          onboarding: onboarding,
          onboardingPostfixUrl: onboarding === true ? '?onboarding=' + config.brand.companyName : '',
          activeOrgUrl: activeOrg ? activeOrg.baseUrl : '/?',
          getOrg: (orgName: string) => {
            return operations.getOrganization(orgName);
          },
          groupedAvailableOrganizations: groupedAvailableOrganizations,
        },
      });
    }
);

router.use('/*splat', async (req: ReposAppRequest, res, next) => {
  // Helper method to allow pasting a GitHub URL into the app to go to a repo
  const { insights } = getProviders(req);
  const full = decodeURIComponent(req.baseUrl.slice(1)); // Remove leading `/`
  // eslint-disable-next-line security/detect-unsafe-regex -- as this is an authenticated route, the value this provides to our authenticated users is worth this
  const match = full.match(/^https?:\/?\/?github\.com\/([^/]+)\/([^/]+)(\/.*)?$/); // Match includes single forward slash
  if (match) {
    const [, org, repo, rest] = match;
    const { operations } = getProviders(req);
    if (org && repo) {
      let organization: Organization = null;
      try {
        organization = operations.getOrganization(org);
      } catch (error) {
        return next(CreateError.InvalidParameters(`Organization ${org} not managed by this system`));
      }
      let repository: Repository = null;
      try {
        repository = organization.repository(repo);
        await repository.getDetails();
      } catch (error) {
        insights?.trackEvent({
          name: 'router.github.splat_error',
          properties: {
            error: error.message,
            org,
            full,
            repo,
            url: req.url,
            baseUrl: req.baseUrl,
          },
        });
        return next(CreateError.NotFound(`The repository ${org}/${repo} doesn't exist.`));
      }
      const destinationUrl = hasReactApp
        ? `/orgs/${repository.organization.name}/repos/${repository.name}`
        : repository.baseUrl;
      insights?.trackMetric({
        name: 'router.github.splat',
        value: 1,
      });
      insights?.trackEvent({
        name: 'router.github.splat.success',
        properties: {
          org,
          full,
          repo,
          url: req.url,
          baseUrl: req.baseUrl,
          destinationUrl,
        },
      });
      return res.redirect(destinationUrl);
    }
  } else {
    insights?.trackEvent({
      name: 'router.github.splat_skipped',
      properties: {
        full,
        url: req.url,
        baseUrl: req.baseUrl,
      },
    });
  }

  return next();
});

router.use(routeLinkedUserRoutes);

export default router;
