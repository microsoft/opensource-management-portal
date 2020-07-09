//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express = require('express');
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ReposAppRequest, IProviders } from '../../../transitional';
import { wrapError } from '../../../utils';
import { ICorporateLink } from '../../../business/corporateLink';
import { Team, GitHubRepositoryType, ITeamMembershipRoleState, GitHubTeamRole } from '../../../business/team';
import { Organization } from '../../../business/organization';
import { IApprovalProvider } from '../../../entities/teamJoinApproval/approvalProvider';
import { Operations } from '../../../business/operations';
import { TeamJoinApprovalEntity } from '../../../entities/teamJoinApproval/teamJoinApproval';
import { AddTeamPermissionsToRequest, IRequestTeamPermissions } from '../../../middleware/github/teamPermissions';
import { AddOrganizationPermissionsToRequest, GetOrganizationPermissionsFromRequest } from '../../../middleware/github/orgPermissions';
import { TeamMember } from '../../../business/teamMember';

import throat from 'throat';
import SelfServiceTeamMemberToMaintainerUpgrades from '../../../features/teamMemberToMaintainerUpgrade';

const lowercaser = require('../../../middleware/lowercaser');
const teamMaintainerRoute = require('./index-maintainer');

const FirstPageMembersCap = 25;
const ParallelMailAddressLookups = 4;

// TODO: PERFORMANCE: The ability to lookup the e-mail address for a member should happen through a dedicated /people/login endpoint that would allow offloading the e-mail lookup functions until actually needed.

interface ILocalRequest extends ReposAppRequest {
  team2?: any;
  membershipStatus?: GitHubTeamRole;
  membershipState?: any;
  orgPermissions?: any;
  sudoMode?: any;
  teamPermissions?: any;
  teamUrl?: any;
  orgOwnersSet?: any;
  teamMaintainers?: any;
  existingRequest?: TeamJoinApprovalEntity;
  otherApprovals?: TeamJoinApprovalEntity[];
  selfServiceTeamMemberToMaintainerUpgrades?: SelfServiceTeamMemberToMaintainerUpgrades;
}

router.use(asyncHandler(async (req: ILocalRequest, res, next) => {
  const { operations } = req.app.settings.providers as IProviders;
  const login = req.individualContext.getGitHubIdentity().username;
  const team2 = req.team2 as Team;
  try {
    const statusResult = await team2.getMembershipEfficiently(login);
    req.membershipStatus = statusResult && (statusResult as ITeamMembershipRoleState).role ? (statusResult as ITeamMembershipRoleState).role : null;
    req.membershipState = statusResult && (statusResult as ITeamMembershipRoleState).state ? (statusResult as ITeamMembershipRoleState).state : null;
  } catch (problem) {
    console.dir(problem);
  }
  if (operations.allowSelfServiceTeamMemberToMaintainerUpgrades()) {
    req.selfServiceTeamMemberToMaintainerUpgrades = new SelfServiceTeamMemberToMaintainerUpgrades({ operations, team: team2 });
  }
  return next();
}));

router.use(asyncHandler(async (req: ILocalRequest, res, next) => {
  const approvalProvider = req.app.settings.providers.approvalProvider as IApprovalProvider;
  const team2 = req.team2 as Team;
  if (!approvalProvider) {
    return next(new Error('No approval provider instance available'));
  }
  const pendingApprovals = await approvalProvider.queryPendingApprovalsForTeam(team2.id.toString());
  const id = req.individualContext.getGitHubIdentity().id;
  req.otherApprovals = [];
  for (let i = 0; i < pendingApprovals.length; i++) {
    const approval = pendingApprovals[i];
    if (approval.thirdPartyId === id) {
      req.existingRequest = approval;
    }
    req.otherApprovals.push(approval);
  }
  return next();
}));

router.use('/join', asyncHandler(AddOrganizationPermissionsToRequest), (req: ILocalRequest, res, next) => {
  const organization = req.organization;
  const team2 = req.team2;
  const orgPermissions = req.orgPermissions;

  // Are they already a team member?
  const currentMembershipStatus = req.membershipStatus;
  if (currentMembershipStatus) {
    return next(wrapError(null, `You are already a ${currentMembershipStatus} of the ${team2.name} team`, true));
  }

  // Have they joined the organization yet?
  const membershipStatus = orgPermissions.membershipStatus;
  let error = null;
  if (membershipStatus !== 'active') {
    error = new Error(`You are not a member of the ${organization.name} GitHub organization.`);
    error.title = 'Please join the organization before joining this team';
    error.detailed = membershipStatus === 'pending' ? 'You have not accepted your membership yet, or do not have two-factor authentication enabled.' : 'After you join the organization, you can join this team.';
    error.skipOops = true;
    error.skipLog = true;
    error.fancyLink = {
      link: `/${organization.name}`,
      title: `Join the ${organization.name} organization`,
    };
  }
  return next(error);
});

router.get('/join', asyncHandler(async function (req: ILocalRequest, res, next) {
  const team2 = req.team2 as Team;
  const organization = req.organization as Organization;
  // The broad access "all members" team is always open for automatic joining without
  // approval. This short circuit is to show that option.
  const broadAccessTeams = new Set(organization.broadAccessTeams);
  if (broadAccessTeams.has(team2.id)) {
    req.individualContext.webContext.render({
      view: 'org/team/join',
      title: `Join ${team2.name}`,
      state: {
        team: team2,
        allowSelfJoin: true,
      },
    });
  }
  const maintainers = (await team2.getOfficialMaintainers()).filter(maintainer => {
    return maintainer && maintainer.login && maintainer.link;
  });
  req.individualContext.webContext.render({
    view: 'org/team/join',
    title: `Join ${team2.name}`,
    state: {
      existingTeamJoinRequest: req.existingRequest,
      team: team2,
      teamMaintainers: maintainers,
    },
  });
}));

router.post('/selfServiceMaintainerUpgrade', asyncHandler(async (req: ILocalRequest, res, next) => {
  const { selfServiceTeamMemberToMaintainerUpgrades } = req;
  if (!selfServiceTeamMemberToMaintainerUpgrades) {
    throw new Error('System not available');
  }
  const individualContext = req.individualContext;
  try {
    await selfServiceTeamMemberToMaintainerUpgrades.validateUserCanSelfServicePromote(individualContext)
  } catch (notEligible) {
    return next(notEligible);
  }
  try {
    await selfServiceTeamMemberToMaintainerUpgrades.upgrade(individualContext);
  } catch (upgradeError) {
    return next(upgradeError);
  }
  individualContext.webContext.saveUserAlert('You are now a Team Maintainer', 'Self-service permission upgrade', 'success');
  return res.redirect(req.team2.baseUrl);
}));

router.post('/join', asyncHandler(async (req: ILocalRequest, res, next) => {
  if (req.existingRequest) {
    throw new Error('You have already created a team join request that is pending a decision.');
  }
  const { config, mailProvider } = req.app.settings.providers as IProviders;
  const organization = req.organization as Organization;
  const operations = req.app.settings.providers.operations as Operations;
  const team2 = req.team2 as Team;
  const broadAccessTeams = new Set(organization.broadAccessTeams);
  const approvalProvider = req.app.settings.providers.approvalProvider as IApprovalProvider;
  if (!approvalProvider) {
    return next(new Error('No approval provider instance available'));
  }
  const username = req.individualContext.getGitHubIdentity().username;
  // TODO: validating types and all that jazz
  if (broadAccessTeams.has(team2.id)) {
    try {
      await team2.addMembership(username);
    } catch (error) {
      req.insights.trackEvent({
        name: 'GitHubJoinAllMembersTeamFailure',
        properties: {
          organization: organization.name,
          username: username,
          error: error.message,
        },
      });
      return next(wrapError(error, `We had trouble adding you to the ${organization.name} organization. ${username}`));
    }
    req.individualContext.webContext.saveUserAlert(`You have joined ${team2.name} team successfully`, 'Join Successfully', 'success');
    req.insights.trackEvent({
      name: 'GitHubJoinAllMembersTeamSuccess',
      properties: {
        organization: organization.name,
        username: username,
      },
    });
    return res.redirect(`${organization.baseUrl}teams`);
  }
  const justification = req.body.justification;
  if (justification === undefined || justification === '') {
    return next(wrapError(null, 'You must include justification for your request.', true));
  }
  const approvalTypesValues = config.github.approvalTypes.repo;
  if (approvalTypesValues.length === 0) {
    return next(new Error('No team join approval providers configured.'));
  }
  const approvalTypes = new Set(approvalTypesValues);
  const mailProviderInUse = approvalTypes.has('mail');
  if (!mailProviderInUse) {
    return next(new Error('No configured approval providers configured.'));
  }
  const approverMailAddresses = [];
  if (mailProviderInUse && !mailProvider) {
    return next(wrapError(null, 'No mail provider is enabled, yet this application is configured to use a mail provider.'));
  }
  const mailAddressProvider = req.app.settings.mailAddressProvider;
  const displayHostname = req.hostname;
  const approvalScheme = displayHostname === 'localhost' && config.webServer.allowHttp === true ? 'http' : 'https';
  const reposSiteBaseUrl = `${approvalScheme}://${displayHostname}/`;
  const approvalBaseUrl = `${reposSiteBaseUrl}approvals/`;
  const personName = req.individualContext.corporateIdentity.displayName || req.individualContext.corporateIdentity.username;
  let personMail = null;
  let requestId = null;
  let approvalRequest = new TeamJoinApprovalEntity();
  try {
    const upn = req.individualContext.corporateIdentity.username;
    personMail = await operations.getMailAddressFromCorporateUsername(upn);
    const isMember = await team2.isMember(username);
    if (isMember === true) {
      return next(wrapError(null, 'You are already a member of the team ' + team2.name, true));
    }
    const maintainers = (await team2.getOfficialMaintainers()).filter(maintainer => {
      return maintainer && maintainer.login && maintainer.link;
    });
    approvalRequest.thirdPartyUsername = req.individualContext.getGitHubIdentity().username;
    approvalRequest.thirdPartyId = req.individualContext.getGitHubIdentity().id;
    approvalRequest.justification = req.body.justification;
    approvalRequest.created = new Date();
    approvalRequest.active = true;
    approvalRequest.organizationName = team2.organization.name;
    approvalRequest.teamId = team2.id.toString();
    approvalRequest.teamName = team2.name;
    approvalRequest.corporateUsername = req.individualContext.corporateIdentity.username;
    approvalRequest.corporateDisplayName = req.individualContext.corporateIdentity.displayName;
    approvalRequest.corporateId = req.individualContext.corporateIdentity.id;

    const randomMaintainer = maintainers[Math.floor(Math.random() * maintainers.length)];
    //assignTo = randomMaintainer ? randomMaintainer.login : '';
    const mnt = [];
    for (let i = 0; i < maintainers.length; i++) {
      const maintainer = maintainers[i];
      mnt.push('@' + maintainer.login);
      const ml = maintainer ? maintainer.link as ICorporateLink : null;
      const approverUpn = ml && ml.corporateUsername ? ml.corporateUsername : null;
      if (approverUpn) {
        const mailAddress = await operations.getMailAddressFromCorporateUsername(approverUpn);
        if (mailAddress) {
          approverMailAddresses.push(mailAddress);
        }
      }
    }
    //allMaintainers = mnt.join(', ');

    //dc.insertApprovalRequest(team2.id, approvalRequest, callback);
    const newRequestId = await approvalProvider.createTeamJoinApprovalEntity(approvalRequest);
    requestId = newRequestId;

    // BREAKING CHANGE
    // (Removed capability): GitHub issue-based tracking of requests

    if (mailProviderInUse) {
      // Send approver mail
      const approversAsString = approverMailAddresses.join(', ');
      const mail = {
        to: approverMailAddresses,
        subject: `${personName} wants to join your ${team2.name} team in the ${team2.organization.name} GitHub org`,
        correlationId: req.correlationId,
        content: undefined,
      };
      const contentOptions = {
        reason: (`You are receiving this e-mail because you are a team maintainer for the GitHub team "${team2.name}" in the ${team2.organization.name} organization.
                  To stop receiving these mails, you can remove your team maintainer status on GitHub.
                  This mail was sent to: ${approversAsString}`),
        category: ['request', 'repos'],
        headline: `${team2.name} permission request`,
        notification: 'action',
        app: 'Microsoft GitHub',
        correlationId: req.correlationId,
        version: config.logging.version,
        actionUrl: approvalBaseUrl + requestId,
        reposSiteUrl: reposSiteBaseUrl,
        approvalRequest: approvalRequest,
        team: team2.name,
        org: team2.organization.name,
        personName: personName,
        personMail: personMail,
      };
      try {
        req.insights.trackEvent({
          eventName: 'ReposTeamRequestMailRenderData',
          properties: {
            data: JSON.stringify(contentOptions),
          },
        });
        mail.content = await operations.emailRender('membershipApprovals/pleaseApprove', contentOptions);
      } catch (renderError) {
        req.insights.trackException({
          exception: renderError,
          properties: {
            content: contentOptions,
            eventName: 'ReposTeamRequestPleaseApproveMailRenderFailure',
          },
        });
        throw renderError;
      }
      let customData: any = {};
      try {
        req.insights.trackEvent({
          eventName: 'ReposTeamRequestMailSendStart',
          properties: {
            mail: JSON.stringify(mail),
          },
        });
        const mailResult = await operations.sendMail(mail);
        customData = {
          content: contentOptions,
          receipt: mailResult,
          eventName: undefined,
        };
        req.insights.trackEvent({ name: 'ReposTeamRequestPleaseApproveMailSuccess', properties: customData });
      } catch (mailError) {
        customData.eventName = 'ReposTeamRequestPleaseApproveMailFailure';
        req.insights.trackException({ exception: mailError, properties: customData });
      }

      // Add to the approval to log who was sent the mail
      const approval = await approvalProvider.getApprovalEntity(requestId);
      approval.mailSentToApprovers = approversAsString;
      // approval.mailSentTo = personMail;
      await approvalProvider.updateTeamApprovalEntity(approval);
    }

    if (mailProviderInUse) {
      // Send requester mail
      const mail = {
        to: personMail,
        subject: `Your ${team2.organization.name} "${team2.name}" permission request has been submitted`,
        correlationId: req.correlationId,
        category: ['request', 'repos'],
        content: undefined,
      };
      const contentOptions = {
        reason: (`You are receiving this e-mail because you requested to join this team.
                  This mail was sent to: ${personMail}`),
        headline: 'Team request submitted',
        notification: 'information',
        app: 'Microsoft GitHub',
        correlationId: req.correlationId,
        version: config.logging.version,
        actionUrl: approvalBaseUrl + requestId,
        reposSiteUrl: reposSiteBaseUrl,
        approvalRequest: approvalRequest,
        team: team2.name,
        org: team2.organization.name,
        personName: personName,
        personMail: personMail,
      };
      try {
        req.insights.trackEvent({
          eventName: 'ReposTeamRequestedMailRenderData',
          properties: {
            data: JSON.stringify(contentOptions),
          },
        });
        mail.content = await operations.emailRender('membershipApprovals/requestSubmitted', contentOptions);
      } catch (renderError) {
        req.insights.trackException({
          exception: renderError,
          properties: {
            content: contentOptions,
            eventName: 'ReposTeamRequestSubmittedMailRenderFailure',
          },
        });
        throw renderError;
      }
      let customData: any = {};
      try {
        req.insights.trackEvent({
          eventName: 'ReposTeamRequestedMailSendStart',
          properties: {
            mail: JSON.stringify(mail),
          },
        });
        const mailResult = await operations.sendMail(mail);
        customData = {
          content: contentOptions,
          receipt: mailResult,
          eventName: undefined,
        };
        req.insights.trackEvent({ name: 'ReposTeamRequestSubmittedMailSuccess', properties: customData });
      } catch (mailError) {
        customData.eventName = 'ReposTeamRequestSubmittedMailFailure';
        req.insights.trackException({ exception: mailError, properties: customData });
        // throw mailError;
      }
    }
  } catch (error) {
    return next(error);
  }

  return res.redirect(team2.baseUrl);
}));

// Adds "req.teamPermissions", "req.teamMaintainers" middleware
router.use(asyncHandler(AddTeamPermissionsToRequest));

// The view uses this information today to show the sudo banner
router.use((req: ILocalRequest, res, next) => {
  if (req.teamPermissions.sudo === true) {
    req.sudoMode = true;
  }
  return next();
});

enum BasicTeamViewPage {
  Default = 'default',
  Repositories = 'repositories',
  History = 'history',
}

async function basicTeamsView(req: ILocalRequest, display: BasicTeamViewPage) {
  const providers = req.app.settings.providers as IProviders;

  const showManagementFeatures = parseInt(req.query['inline-management'] as string) == 1;

  const idAsString = req.individualContext.getGitHubIdentity().id;
  const id = idAsString ? parseInt(idAsString, 10) : null;
  const teamPermissions = req.teamPermissions as IRequestTeamPermissions;
  const membershipStatus = req.membershipStatus;
  const membershipState = req.membershipState;
  const team2 = req.team2 as Team;
  const operations = req.app.settings.operations as Operations;
  const organization = req.organization as Organization;

  const teamMaintainers = req.teamMaintainers as TeamMember[];
  const maintainersSet = new Set();
  for (let i = 0; i < teamMaintainers.length; i++) {
    maintainersSet.add(teamMaintainers[i].id);
  }

  let membersFirstPage: TeamMember[] = [];
  let teamDetails = null;
  let repositories = null;

  const isBroadAccessTeam = team2.isBroadAccessTeam;
  const isSystemTeam = team2.isSystemTeam;

  const orgOwnersSet = req.orgOwnersSet;
  let isOrgOwner = orgOwnersSet ? orgOwnersSet.has(id) : false;

  // Get the first page (by 100) of members, we only show a subset of 25
  if (display === BasicTeamViewPage.Default) {
    const firstPageOptions = {
      pageLimit: 1,
      backgroundRefresh: true,
      maxAgeSeconds: 60,
    };
    const membersSubset = await team2.getMembers(firstPageOptions);
    membersFirstPage = membersSubset.slice(0, FirstPageMembersCap);
  }

  const details = await team2.getDetails();
  teamDetails = details;

  if (display === BasicTeamViewPage.Repositories) {
    const onlySourceRepositories = {
      type: GitHubRepositoryType.Sources,
    };
    let reposWithPermissions = null;
    try {
      if (display === BasicTeamViewPage.Repositories) {
        reposWithPermissions = await team2.getRepositories(onlySourceRepositories);
        repositories = reposWithPermissions.sort(sortByNameCaseInsensitive);
      }
    } catch (ignoredError) {
      console.dir(ignoredError);
    }
  }

  const map = new Map<number, ICorporateLink>();
  let links: ICorporateLink[] = null;
  if (Math.max(teamMaintainers.length, membersFirstPage.length) > FirstPageMembersCap) {
    links = await operations.getLinks();
  } else {
    const ids = Array.from((new Set([...teamMaintainers, ...membersFirstPage].map(tm => String(tm.id)))).values());
    links = await operations.getLinksFromThirdPartyIds(ids);
  }

  for (let i = 0; i < links.length; i++) {
    const id = links[i].thirdPartyId;
    if (id) {
      map.set(parseInt(id, 10), links[i]);
    }
  }
  addLinkToList(teamMaintainers, map);
  await resolveMailAddresses(operations, teamMaintainers);

  if (display === BasicTeamViewPage.Default) {
    addLinkToList(membersFirstPage, map);
    await resolveMailAddresses(operations, membersFirstPage);
  }

  const organizationPermissions = GetOrganizationPermissionsFromRequest(req);

  let history = null;
  if (display === BasicTeamViewPage.History && providers.auditLogRecordProvider) {
    const { auditLogRecordProvider } = providers;
    history = await auditLogRecordProvider.queryAuditLogForTeamOperations(team2.id.toString());
  }

  let title = team2.name;
  if (display === BasicTeamViewPage.Repositories) {
    title = `Repositories - ${team2.name}`;
  } else if (display === BasicTeamViewPage.History) {
    title = `History - ${team2.name}`;
  }

  const mailSubjectSuffix = `?subject=${team2.name} GitHub team`;
  const maintainerMails = teamMaintainers.map(maint => maint.mailAddress).filter(val => val);
  let mailToMaintainers = maintainerMails.length ? `mailto:${maintainerMails.join(';')}${mailSubjectSuffix}` : null;
  let mailToMaintainersCount = maintainerMails.length;

  // on purpose the members would only include those shown on the first page here if there are less than the cap # of members
  const memberMails = membersFirstPage.map(mem => mem.mailAddress).filter(val => val);
  let mailToMembers = memberMails.length && memberMails.length !== FirstPageMembersCap ? `mailto:${memberMails.join(';')}${mailSubjectSuffix}` : null;
  let mailToMembersCount = memberMails.length;

  const { selfServiceTeamMemberToMaintainerUpgrades } = req;
  let isSelfServiceMemberToMaintainerEligible = false;
  if (display === BasicTeamViewPage.Default && req.membershipStatus === GitHubTeamRole.Member && selfServiceTeamMemberToMaintainerUpgrades) {
    const isTeamEligible = await selfServiceTeamMemberToMaintainerUpgrades.isTeamEligible(true /* cache is OK */);
    if (typeof (isTeamEligible) !== 'string') {
      isSelfServiceMemberToMaintainerEligible = true;
    }
  }

  return req.individualContext.webContext.render({
    view: 'org/team/index',
    title,
    state: {
      display,
      team: team2,
      teamUrl: req.teamUrl, // ?
      employees: [], // data.employees,
      otherApprovals: req.otherApprovals,

      // changed implementation:
      maintainers: teamMaintainers,
      maintainersSet,

      history,

      // new values:
      teamPermissions,
      membershipStatus,
      membershipState,
      membersFirstPage,
      team2,
      teamDetails,
      organization,
      isBroadAccessTeam,
      isSystemTeam,
      repositories,
      isOrgOwner,
      orgOwnersSet,
      organizationPermissions,

      showManagementFeatures,

      // contacts
      mailToMaintainers,
      mailToMaintainersCount,
      mailToMembers,
      mailToMembersCount,

      // provider refactoring additions
      existingTeamJoinRequest: req.existingRequest,

      // self-service feature
      isSelfServiceMemberToMaintainerEligible,
    },
  });
}

router.get('/', asyncHandler(AddOrganizationPermissionsToRequest), async (req: ILocalRequest, res, next) => {
  await basicTeamsView(req, BasicTeamViewPage.Default);
});

router.get('/history', asyncHandler(AddOrganizationPermissionsToRequest), async (req: ILocalRequest, res, next) => {
  await basicTeamsView(req, BasicTeamViewPage.History);
});

router.get('/repositories', asyncHandler(AddOrganizationPermissionsToRequest), async (req: ILocalRequest, res, next) => {
  await basicTeamsView(req, BasicTeamViewPage.Repositories);
});

function addLinkToList(array: TeamMember[], linksMap: Map<number, ICorporateLink>) {
  for (let i = 0; i < array.length; i++) {
    const entry = array[i];
    const link = linksMap.get(entry.id);
    if (link) {
      entry.link = link;
    }
  }
}

async function resolveMailAddresses(operations: Operations, array: TeamMember[]): Promise<void> {
  const mailAddressProvider = operations.mailAddressProvider;
  if (!mailAddressProvider) {
    return;
  }
  const throttle = throat(ParallelMailAddressLookups);
  await Promise.all(array.map(entry => throttle(async () => {
    try {
      await entry.getMailAddress();
    } catch (ignoreError) {
      console.warn(ignoreError);
    }
  })));
}

function sortByNameCaseInsensitive(a, b) {
  let nameA = a.name.toLowerCase();
  let nameB = b.name.toLowerCase();
  if (nameA < nameB) {
    return -1;
  }
  if (nameA > nameB) {
    return 1;
  }
  return 0;
}

router.use('/members', require('./members'));
router.get('/repos', lowercaser(['sort', 'language', 'type', 'tt']), require('../../reposPager'));
router.use('/delete', require('./delete'));
router.use('/properties', require('./properties'));
router.use('/maintainers', require('./maintainers'));
router.use('/leave', require('./leave'));

router.use(teamMaintainerRoute);

module.exports = router;
