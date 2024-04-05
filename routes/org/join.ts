//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// the changes in Further-UI-Improvements did not merge well, need to review by hand

import { Router, Response, NextFunction } from 'express';
import asyncHandler from 'express-async-handler';
const router: Router = Router();

import querystring from 'querystring';

import { CreateError, getProviders } from '../../lib/transitional';
import { IndividualContext } from '../../business/user';
import { sleep, storeOriginalUrlAsReferrer, wrapError } from '../../lib/utils';
import RequireActiveGitHubSession from '../../middleware/github/requireActiveSession';
import { jsonError } from '../../middleware/jsonError';
import { Organization, Team } from '../../business';
import QueryCache from '../../business/queryCache';
import {
  ReposAppRequest,
  OrganizationMembershipState,
  OrganizationMembershipRole,
  NoCacheNoBackground,
  ITeamMembershipRoleState,
  IOrganizationMembership,
  OrganizationMembershipRoleQuery,
} from '../../interfaces';
import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment';

//-------------
// Join checks
//-------------
router.use(function (req: ReposAppRequest, res: Response, next: NextFunction) {
  const organization = req.organization;
  let err = null;

  if (organization.locked) {
    const { allowUsersToViewLockedOrgDetails } = getProviders(req).config.features;

    if (allowUsersToViewLockedOrgDetails) {
      return showOrgJoinDetails(req);
    }

    console.error(
      `Default functionality does not allow users to access the join page of a locked organization.  To override this set the feature flag 'FEATURE_FLAG_ALLOW_USERS_TO_VIEW_LOCKED_ORG_DETAILS=1'`
    );

    err = new Error('This organization is locked to new members.');
    err.detailed = `At this time, the maintainers of the ${organization.name} organization have decided to not enable onboarding through this portal.`;
    err.skipLog = true;
    next(err);
  }

  next();
});

router.use(
  asyncHandler(async function (req: ReposAppRequest, res: Response, next: NextFunction) {
    try {
      const providers = getProviders(req);
      const companySpecific = getCompanySpecificDeployment();
      const organization = req.organization;
      if (companySpecific?.features?.organizationJoinAcl?.tryAuthorizeOrganizationJoin) {
        const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
        await companySpecific.features.organizationJoinAcl.tryAuthorizeOrganizationJoin(
          providers,
          organization,
          activeContext
        );
      }
    } catch (interceptJoinError) {
      return next(interceptJoinError);
    }
    return next();
  })
);

//-------------

router.use(RequireActiveGitHubSession);

async function showOrgJoinDetails(req: ReposAppRequest) {
  // Present user with a sanitized version of the organization detail page for users attempting to join a locked
  // organization when the ALLOW_USERS_TO_VIEW_LOCKED_ORG_DETAILS feature flag is enabled.  Attempting to keep
  // this implementation as close to the default org get route as possible
  const { individualContext, organization } = req;

  const [orgDetails, organizationOverview, organizationAdmins] = await Promise.all([
    organization.getDetails(),
    individualContext.aggregations.getAggregatedOrganizationOverview(organization),
    organization.getOwnersCardData(),
  ]);

  const results = {
    orgUser: organization.memberFromEntity(orgDetails),
    orgDetails, //org details from GitHub
    organizationOverview,
    organizationAdmins,
  };

  req.individualContext.webContext.render({
    view: 'org/publicView',
    title: organization.name,
    state: {
      accountInfo: results,
      organization,
      organizationEntity: organization.getEntity(),
    },
  });
}

function clearAuditListAndRedirect(
  res: Response,
  organization: Organization,
  onboarding: boolean,
  req: any,
  state: OrganizationMembershipState
) {
  // Behavior change, only important to those not using GitHub's 2FA enforcement feature; no longer clearing the cache
  const url =
    organization.baseUrl +
    'security-check' +
    (onboarding ? '?onboarding=' + onboarding : '?joining=' + organization.name);
  if (state === OrganizationMembershipState.Active && req) {
    req.individualContext.webContext.saveUserAlert(
      `You successfully joined the ${organization.name} organization!`,
      organization.name,
      'success'
    );
  }
  return res.redirect(url);
}

function queryParamAsBoolean(input: string): boolean {
  try {
    return !!JSON.parse(input);
  } catch (e) {
    return false;
  }
}

router.get(
  '/',
  asyncHandler(async function (req: ReposAppRequest, res: Response, next: NextFunction) {
    const providers = getProviders(req);
    const { operations } = providers;
    const organization = req.organization;
    const username = req.individualContext.getGitHubIdentity().username;
    const id = req.individualContext.getGitHubIdentity().id;
    const accountFromId = operations.getAccount(id);
    const accountDetails = await accountFromId.getDetails();
    const link = req.individualContext.link;
    const userIncreasedScopeToken = req.individualContext.webContext.tokens.gitHubWriteOrganizationToken;
    const onboarding = queryParamAsBoolean(req.query.onboarding as string);
    let showTwoFactorWarning = false;
    let showApplicationPermissionWarning = false;
    let writeOrgFailureMessage = null;
    const result = await organization.getOperationalMembership(username);
    const state = result && result.state ? result.state : false;
    if (state === OrganizationMembershipState.Active) {
      await addMemberToOrganizationCache(providers.queryCache, organization, id);
      return clearAuditListAndRedirect(res, organization, onboarding, req, state);
    } else if (state === 'pending' && userIncreasedScopeToken) {
      let updatedState;
      try {
        updatedState = await organization.acceptOrganizationInvitation(userIncreasedScopeToken);
        if (updatedState && updatedState.state === OrganizationMembershipState.Active) {
          await addMemberToOrganizationCache(providers.queryCache, organization, id);
          return clearAuditListAndRedirect(res, organization, onboarding, req, state);
        }
      } catch (error) {
        // We do not error out, they can still fall back on the
        // manual acceptance system that the page will render.
        writeOrgFailureMessage =
          error.message ||
          'The GitHub API did not allow us to join the organization for you. Follow the instructions to continue.';
        if (error.statusCode == 401) {
          // These comparisons should be == and not ===
          return redirectToIncreaseScopeExperience(req, res, 'GitHub API status code was 401');
        } else if (error.statusCode == 403 && writeOrgFailureMessage.includes('two-factor')) {
          showTwoFactorWarning = true;
        } else if (error.statusCode == 403) {
          showApplicationPermissionWarning = true;
        }
      }
    }

    const details = await organization.getDetails();
    const userDetails = details ? organization.memberFromEntity(details) : null;
    userDetails['entity'] /* adding to the object */ = details;
    const title = organization.name + ' Organization Membership ' + (state == 'pending' ? 'Pending' : 'Join');
    req.individualContext.webContext.render({
      view: 'org/pending',
      title,
      state: {
        result,
        state,
        supportsExpressJoinExperience: true,
        hasIncreasedScope: userIncreasedScopeToken ? true : false,
        organization,
        orgAccount: userDetails,
        onboarding,
        writeOrgFailureMessage,
        showTwoFactorWarning,
        showApplicationPermissionWarning,
        link,
        accountDetails,
      },
    });
  })
);

function redirectToIncreaseScopeExperience(req, res, optionalReason) {
  storeOriginalUrlAsReferrer(req, res, '/auth/github/increased-scope', optionalReason);
}

async function addMemberToOrganizationCache(
  queryCache: QueryCache,
  organization: Organization,
  userId: string
): Promise<void> {
  if (queryCache && queryCache.supportsOrganizationMembership) {
    try {
      await queryCache.addOrUpdateOrganizationMember(
        organization.id.toString(),
        OrganizationMembershipRole.Member,
        userId
      );
    } catch (ignored) {}
  }
}

router.get(
  '/express',
  asyncHandler(async function (req: ReposAppRequest, res: Response, next: NextFunction) {
    const providers = getProviders(req);
    const insights = providers.insights;
    const username = req.individualContext.getGitHubIdentity().username;
    const organization = req.organization;
    const onboarding = queryParamAsBoolean(req.query.onboarding as string);
    insights?.trackEvent({
      name: 'OrganizationJoinExpress',
      properties: {
        username,
        organization: organization.name,
        onboarding,
      },
    });
    const id = req.individualContext.getGitHubIdentity().id;
    const result = await organization.getOperationalMembership(username);
    // CONSIDER: in the callback era the error was never thrown or returned. Was that on purpose?
    const state = result && result.state ? result.state : false;
    insights?.trackEvent({
      name: 'OrganizationJoinExpressResponse',
      properties: {
        username,
        organization: organization.name,
        onboarding,
        state: state || 'unknown',
        result: result ? JSON.stringify(result, null, 2) : 'null or unknown',
      },
    });
    if (state === OrganizationMembershipState.Active) {
      await addMemberToOrganizationCache(providers.queryCache, organization, id);
    }
    if (state === OrganizationMembershipState.Active || state === OrganizationMembershipState.Pending) {
      res.redirect(
        organization.baseUrl +
          'join' +
          (onboarding ? '?onboarding=' + onboarding : '?joining=' + organization.name)
      );
    } else if (req.individualContext.webContext.tokens.gitHubWriteOrganizationToken) {
      // TODO: is this the right approach to use with asyncHandler and sub-awaits and sub-routes?
      return await joinOrg(req, res, next);
    } else {
      return storeOriginalUrlAsReferrer(
        req,
        res,
        '/auth/github/increased-scope',
        'need to get increased scope and current org state is ' + state
      );
    }
  })
);

async function joinOrg(req: ReposAppRequest, res: Response, next: NextFunction) {
  const individualContext = req.individualContext as IndividualContext;
  const { insights } = getProviders(req);
  const organization = req.organization as Organization;
  const onboarding = queryParamAsBoolean(req.query.onboarding as string);
  const username = individualContext.getGitHubIdentity().username;
  if (!username) {
    throw new Error("A GitHub username was not found in the user's link.");
  }
  const result = await joinOrganization(req, individualContext, organization, req.insights, onboarding);
  insights?.trackEvent({
    name: 'OrganizationJoinOrgMethod',
    properties: {
      username,
      organization: organization.name,
      result: result ? JSON.stringify(result, null, 2) : 'null or empty',
    },
  });
  return res.redirect(
    organization.baseUrl +
      'join' +
      (onboarding ? '?onboarding=' + onboarding : '?joining=' + organization.name)
  );
}

async function joinOrganization(
  req,
  individualContext: IndividualContext,
  organization: Organization,
  insights,
  isOnboarding: boolean
): Promise<any> {
  const username = individualContext.getGitHubIdentity().username;
  if (!username) {
    throw new Error("A GitHub username was not found in the user's link.");
  }
  const { campaignStateProvider } = getProviders(req);
  const campaignGroupId = 'org-invite-block';

  if (campaignStateProvider) {
    const invitationState = await campaignStateProvider.getState(
      individualContext.corporateIdentity.id,
      campaignGroupId,
      organization.name
    );

    if (invitationState?.sent) {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      if (invitationState.sent > hourAgo) {
        insights.trackMetric({ name: 'GitHubOrgInvitationBlocks', value: 1 });
        insights.trackEvent({
          name: 'GitHubOrgInvitationBlock',
          properties: {
            organization: organization.name,
            username,
          },
        });
        throw CreateError.InvalidParameters(
          `You have already sent an invitation to ${organization.name} in the last hour. Double-check for your invitation at https://github.com/${organization.name}.`
        );
      }
    }
  }

  const invitationTeam = organization.invitationTeam as Team;
  let okToSendInvite = true;
  let multipleInvitationDebugMessage = null;
  try {
    if (invitationTeam) {
      const status = await invitationTeam.getMembership(username, NoCacheNoBackground);
      const statusAsType = status as ITeamMembershipRoleState;
      if (!status) {
        // ok state, we can join
        multipleInvitationDebugMessage =
          'This is a new invitation for the user to join the team and organization.';
      } else if (statusAsType.state === OrganizationMembershipState.Active) {
        // do not send a new invite!
        okToSendInvite = false;
        multipleInvitationDebugMessage =
          'This user already has an active membership, do not re-invite to the team and org.';
      } else if (statusAsType.state === OrganizationMembershipState.Pending) {
        // definitely do not send an invite!
        okToSendInvite = false;
        multipleInvitationDebugMessage = 'There is already a pending invitation that needs to be accepted.';
      }
    } else {
      await organization.getOperationalMembership(username);
      await sleep(500); // attempting to prevent multiple invitation situations
      const status = await organization.getOperationalMembership(username);
      const statusAsType = status as IOrganizationMembership;
      if (!status) {
        // ok state, we can join
        multipleInvitationDebugMessage = 'This is a new invitation for the user to join the organization.';
      } else if (statusAsType.state === OrganizationMembershipState.Active) {
        // do not send a new invite!
        okToSendInvite = false;
        multipleInvitationDebugMessage =
          'This user already has an active membership, do not re-invite to the org.';
      } else if (statusAsType.state === OrganizationMembershipState.Pending) {
        // definitely do not send an invite!
        okToSendInvite = false;
        multipleInvitationDebugMessage =
          'There is already a pending invitation that needs to be accepted to this org on GitHub.';
      }
      insights.trackEvent({
        name: 'GitHubOrgInvitationStateCheck',
        properties: {
          organization: organization.name,
          username,
          invitationType: invitationTeam ? 'team' : 'org',
          okToSendInvite: String(okToSendInvite),
          multipleInvitationDebugMessage,
          githubState: status ? status.state : 'no response, no status',
          githubRole: status ? status.role : 'no response, no role',
        },
      });
    }
  } catch (error) {
    insights?.trackException({ exception: error });
  }
  if (!okToSendInvite) {
    insights.trackMetric({ name: 'GitHubOrgInvitationMultiAvoids', value: 1 });
    insights.trackEvent({
      name: 'GitHubOrgInvitationMultiAvoid',
      properties: {
        organization: organization.name,
        username,
      },
    });
    return { okToSendInvite, multipleInvitationDebugMessage };
  }
  let joinResult = null;
  try {
    joinResult = invitationTeam
      ? await invitationTeam.addMembership(username, null)
      : await organization.addMembership(username, null);
    req.individualContext.webContext.saveUserAlert(
      `You successfully joined the ${organization.name} organization!`,
      organization.name,
      'success'
    );
    insights.trackMetric({ name: 'GitHubOrgInvitationSuccesses', value: 1 });
    insights.trackEvent({
      name: 'GitHubOrgInvitationSuccess',
      properties: {
        organization: organization.name,
        invitationType: invitationTeam ? 'team' : 'org',
        username,
      },
    });

    if (campaignStateProvider) {
      await campaignStateProvider.setSent(
        individualContext.corporateIdentity.id,
        campaignGroupId,
        organization.name
      );
    }
  } catch (error) {
    insights.trackMetric({ name: 'GitHubOrgInvitationFailures', value: 1 });
    insights.trackEvent({
      name: 'GitHubOrgInvitationFailure',
      properties: {
        organization: organization.name,
        username,
        invitationType: invitationTeam ? 'team' : 'org',
        error,
      },
    });
    let specificMessage = error.message
      ? 'Error message: ' + error.message
      : 'Please try again later. If you continue to receive this message, please reach out for us to investigate.';
    if (error.code === 'ETIMEDOUT') {
      specificMessage = 'The GitHub API timed out.';
    }
    throw wrapError(
      error,
      `We had trouble sending you an invitation through GitHub to join the ${organization.name} organization. ${username} ${specificMessage}`
    );
  }

  return joinResult;
}

router.post('/', joinOrg);

// /orgname/join/byClient
router.post(
  '/byClient',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const shouldAttemptAcceptingInvitations = false;
    const { queryCache, insights } = getProviders(req);
    const individualContext = req.individualContext as IndividualContext;
    const organization = req.organization as Organization;
    const username = individualContext.getGitHubIdentity().username;
    const onboarding = queryParamAsBoolean(req.query.onboarding as string);
    insights?.trackEvent({
      name: 'JoinOrganizationByClientRequest',
      properties: {
        username,
        organization: organization.name,
        onboarding,
      },
    });
    try {
      const result = await joinOrganization(req, individualContext, organization, req.insights, onboarding);
      if (result && result.multipleInvitationDebugMessage) {
        res.header('x-multiple-invitation-debug-message', result.multipleInvitationDebugMessage);
      }
      insights?.trackEvent({
        name: 'JoinOrganizationByClientResponse',
        properties: {
          username,
          organization: organization.name,
          onboarding,
          outcome: result ? JSON.stringify(result, null, 2) : 'null or empty',
        },
      });
    } catch (error) {
      return next(jsonError(error, 400));
    }
    let xGitHubSsoUrl: string = null;
    if (shouldAttemptAcceptingInvitations) {
      try {
        const result = await organization.getOperationalMembership(username);
        const state = result && result.state ? result.state : false;
        if (
          state === OrganizationMembershipState.Pending &&
          individualContext.hasGitHubOrganizationWriteToken()
        ) {
          const userIncreasedScopeToken = individualContext.webContext?.tokens?.gitHubWriteOrganizationToken;
          const updatedState = await organization.acceptOrganizationInvitation(userIncreasedScopeToken);
          if (updatedState && updatedState.state === OrganizationMembershipState.Active) {
            insights?.trackMetric({
              name: 'ClientOrgInvitationAutomatedAccepts',
              value: 1,
            });
            insights?.trackEvent({
              name: 'ClientOrgInvitationAccepted',
              properties: {
                username,
                hasGitHubOrganizationWriteToken: 'yes',
                beforeAcceptState: state,
                updatedState,
                message: 'accept method did work',
              },
            });
            await addMemberToOrganizationCache(
              queryCache,
              organization,
              individualContext.getGitHubIdentity().id
            );
          }
        } else {
          insights?.trackMetric({
            name: 'ClientOrgInvitationAutomatedUnaccepts',
            value: 1,
          });
          insights?.trackEvent({
            name: 'ClientOrgInvitationAutomatedUnAccepts',
            properties: {
              username,
              hasGitHubOrganizationWriteToken: 'yes',
              beforeAcceptState: state,
              message: 'State did not change to Active but no Error',
            },
          });
        }
      } catch (error) {
        // NOT an error to bubble up, since they at least received an invitation.
        console.warn(error);
        if (error['x-github-sso-url']) {
          xGitHubSsoUrl = error['x-github-sso-url'];
          console.log(
            `Needs to authorize the OAuth application for SAML use by navigating to: ${xGitHubSsoUrl}`
          );
        }
        insights?.trackMetric({
          name: 'ClientOrgInvitationAcceptFailures',
          value: 1,
        });
        insights?.trackException({ exception: error });
        insights?.trackEvent({
          name: 'ClientOrgInvitationAcceptFailure',
          properties: {
            message: error.toString(),
            username,
            xGitHubSsoUrl,
          },
        });
      }
    }
    const qs: any = {};
    if (onboarding) {
      qs.onboarding = onboarding;
    } else {
      qs.joining = organization.name;
    }
    if (xGitHubSsoUrl) {
      qs.sso = xGitHubSsoUrl;
    }
    const q = Object.getOwnPropertyNames(qs).length > 0 ? `?${querystring.stringify(qs)}` : '';
    const destinationUrl = `/orgs/${organization.name}/join${q}`;
    insights?.trackEvent({
      name: 'ClientOrgInvitationRedirect',
      properties: {
        username,
        destinationUrl,
      },
    });
    return res.redirect(destinationUrl);
  })
);

export default router;
