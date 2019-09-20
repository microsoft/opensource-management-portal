//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log", "warn"] }] */

'use strict';

const teamTypes = ['read', 'write', 'admin'];
const defaultLargeAdminTeamSize = 250;

import async = require('async');
import { Operations } from '../../business/operations';

const emailRender = require('../../lib/emailRender');
const app = require('../../app');

interface IAutomaticTeamsMail {
  to: string;
  cc?: string;
  subject: string;
  category?: string[];
  content?: string;
}

interface ICustomDataEventName {
  content?: string;
  receipt: string;
  eventName?: string;
}

function processOrgSpecialTeams(organization) {
  const specialTeams = organization.specialRepositoryPermissionTeams;
  let specials = [];
  let specialTeamIds = new Set();
  let specialTeamLevels = new Map();
  teamTypes.forEach(specialTeam => {
    if (specialTeams[specialTeam] && specialTeams[specialTeam].length) {
      specials.push(specialTeam);
      for (let i = 0; i < specialTeams[specialTeam].length; i++) {
        const teamId = specialTeams[specialTeam][i];
        specialTeamIds.add(teamId);
        specialTeamLevels.set(teamId, translateSpecialToGitHub(specialTeam));
      }
    }
  });
  return [specialTeams, specials, specialTeamIds, specialTeamLevels];
}

module.exports = {
  processOrgSpecialTeams: processOrgSpecialTeams,
  filter: function (data) {
    const eventType = data.properties.event;
    const eventAction = data.body.action;

    // Someone added a team to the repo
    if (eventType === 'team' && ['add_repository', 'added_to_repository'].includes(eventAction)) {
      return true;
    }

    // Someone removed a team from the repo
    if (eventType === 'team' && eventAction === 'removed_from_repository') {
      return true;
    }

    // Team permission level changed
    if (eventType === 'team' && eventAction === 'edited') {
      return true;
    }

    // A new repo may need the teams
    if (eventType === 'repository' && eventAction === 'created') {
      return true;
    }

    return false;
  },
  run: function (operations: Operations, organization, data, callback) {
    const eventType = data.properties.event;
    const eventAction = data.body.action;
    const destructured = processOrgSpecialTeams(organization); // const [/*specialTeams*/, /*specials*/, specialTeamIds, specialTeamLevels] = processOrgSpecialTeams(organization);
    const specialTeamIds = destructured[2];
    const specialTeamLevels = destructured[3];
    const preventLargeTeamPermissions = organization.preventLargeTeamPermissions;
    const recoveryTasks = [];
    const repositoryBody = data.body.repository;
    const newPermissions = repositoryBody ? repositoryBody.permissions : null;
    const whoChangedIt = data.body && data.body.sender ? data.body.sender.login : null;
    const whoChangedItId = whoChangedIt ? data.body.sender.id : null;

    function finalizeEventRemediation(immediateError?: any) {
      if (immediateError) {
        return callback(immediateError);
      }
      if (recoveryTasks.length <= 0) {
        return callback();
      }
      async.waterfall(recoveryTasks, (error) => {
        const insights = operations.insights;
        if (error) {
          insights.trackException({ exception: error });
        }
        return callback(error);
      });
    }

    // New repository
    if (eventType === 'repository' && eventAction === 'created') {
      specialTeamIds.forEach(teamId => {
        const necessaryPermission = specialTeamLevels.get(teamId);
        recoveryTasks.push(createSetTeamPermissionTask(operations, organization, repositoryBody, teamId, necessaryPermission, `a new repository was created by username ${whoChangedIt}, setting automatic permissions`));
      });
    } else if (eventType === 'team') {
      const teamBody = data.body.team;
      const teamId = teamBody.id;
      const teamName = teamBody.name;

      // Enforce required special team permissions
      if (specialTeamIds.has(teamId)) {
        const necessaryPermission = specialTeamLevels.get(teamId);
        if (!necessaryPermission) {
          return callback(new Error(`No ideal permission level found for the team ${teamId}.`));
        }
        if (eventAction === 'removed_from_repository') {
          // Someone removed the entire team
          recoveryTasks.push(createSetTeamPermissionTask(operations, organization, repositoryBody, teamId, necessaryPermission, `the team and its permission were removed by the username ${whoChangedIt}`));
        } else if (eventAction === 'edited') {
          // The team no longer has the appropriate permission level
          if (newPermissions[necessaryPermission] !== true) {
            recoveryTasks.push(createSetTeamPermissionTask(operations, organization, repositoryBody, teamId, necessaryPermission, `the permission was downgraded by the username ${whoChangedIt}`));
          }
        }
        return finalizeEventRemediation();
      }

      // Prevent granting large teams access
      if (preventLargeTeamPermissions) {
        return getTeamSize(organization, teamId, (getTeamError, teamSize) => {
          if (getTeamError) {
            return callback(getTeamError);
          }
          // Special thanks to the GitHub API team. The added_to_repository event did not
          // include the 'permissions' information. Fixed and deployed by GitHub on
          // 6/13/17. Thank you for helping us simplify our code!
          if (['added_to_repository', 'edited'].includes(eventAction) && newPermissions) {
            const specificReason = teamTooLargeForPurpose(teamId, newPermissions.admin, newPermissions.push, organization, teamSize, preventLargeTeamPermissions);
            if (specificReason) {
              // CONSIDER: system/ops accounts may actually be useful to consider allowing via operations.isSystemAccountByUsername
              addLargeTeamPermissionRevertTasks(recoveryTasks, operations, organization, repositoryBody, teamId, teamName, whoChangedIt, whoChangedItId, specificReason);
            }
          }
          return finalizeEventRemediation();
        });
      }
    }

    return finalizeEventRemediation();
  },
};

function teamTooLargeForPurpose(teamId, isAdmin, isPush, organization, teamSize, preventLargeTeamPermissions) {
  const broadAccessTeams = organization.broadAccessTeams;
  let isBroadAccessTeam = broadAccessTeams && broadAccessTeams.includes(teamId);
  if (isBroadAccessTeam && (isAdmin || isPush)) {
    return 'The team is a very broad access team and does not allow push (write) or admin access to prevent widespread escalation of privileges and spamming thousands of people';
  }
  let teamSizeLimitAdmin = defaultLargeAdminTeamSize;
  let teamSizeLimitType = 'default limit';
  if (preventLargeTeamPermissions && preventLargeTeamPermissions.maximumAdministrators) {
    teamSizeLimitAdmin = preventLargeTeamPermissions.maximumAdministrators;
    teamSizeLimitType = `administrator team limit in the ${organization.name} organization`;
  }
  if (isAdmin && teamSize >= teamSizeLimitAdmin) {
    return `The team has ${teamSize} members which surpasses the ${teamSizeLimitAdmin} ${teamSizeLimitType}`;
  }

  return false;
}

function translateSpecialToGitHub(ourTerm) {
  switch (ourTerm) {
  case 'admin':
    return 'admin';
  case 'write':
    return 'push';
  case 'read':
    return 'pull';
  }
  throw new Error(`Unknown team type ${ourTerm}`);
}

function getTeamSize(organization, teamId, callback) {
  const team = organization.team(teamId);
  team.getDetails(error => {
    if (error) {
      return callback(error);
    }
    return callback(null, team.members_count || 0);
  });
}

function addLargeTeamPermissionRevertTasks(recoveryTasks, operations, organization, repositoryBody, teamId, teamName, whoChangedIt, whoChangedItId, specificReason) {
  specificReason = specificReason ? ': ' + specificReason : '';
  const blockReason = `the permission was upgraded by ${whoChangedIt} but a large team permission prevention feature has reverted the change${specificReason}`;
  console.log(blockReason);
  const insights = operations.insights;
  insights.trackMetric({ name: 'JobAutomaticTeamsLargeTeamPermissionBlock', value: 1 });
  insights.trackEvent({
    name: 'JobAutomaticTeamsLargeTeamPermissionBlocked',
    properties: {
      specificReason: specificReason,
      teamId: teamId,
      organization: organization.name,
      repository: repositoryBody.name,
      whoChangedIt: whoChangedIt,
      whoChangedItId: whoChangedItId,
    },
  });
  recoveryTasks.push(createSetTeamPermissionTask(operations, organization, repositoryBody, teamId, 'pull', blockReason));
  const owner = repositoryBody.owner.login.toLowerCase(); // We do not want to notify for each fork, if the permissions bubble to the fork
  if (owner === organization.name.toLowerCase()) {
    recoveryTasks.push(createLargeTeamPermissionPreventionWarningMailTask(operations, organization, repositoryBody, teamId, teamName, blockReason, whoChangedIt, whoChangedItId));
  }
}

function createLargeTeamPermissionPreventionWarningMailTask(operations: Operations, organization, repositoryBody, teamId, teamName, reason, whoChangedIt, whoChangedItId) {
  // System accounts should not need notifications
  const mailProvider = operations.providers.mailProvider;
  const insights = operations.providers.insights;
  if (!mailProvider || operations.isSystemAccountByUsername(whoChangedIt)) {
    return emptyCallback;
  }
  const senderMember = organization.member(whoChangedItId);
  return callback => {
    senderMember.getMailAddress((error, mailAddress) => {
      if (error || !mailAddress) {
        return emptyCallback;
      }
      const basedir = operations.config.typescript.appDirectory;
      sendEmail(insights, basedir, mailProvider, mailAddress, {
        repository: repositoryBody,
        whoChangedIt: whoChangedIt,
        teamName: teamName,
        companyName: app.config.brand.companyName,
        reason: reason,
      }, callback);
    });
  };
}

function emptyCallback(callback) {
  return callback();
}

function sendEmail(insights, basedir, mailProvider, to, body, callback) {
  body.reason = `You are receiving this e-mail because you changed the permissions on the ${body.teamName} GitHub team, triggering this action.`;
  body.headline = 'Team permission change reverted';
  body.notification = 'warning';
  body.app = app.settings.operations.config.brand.companyName + ' GitHub';
  const mail: IAutomaticTeamsMail = {
    to: to,
    cc: 'jwilcox@microsoft.com',
    subject: `Team permission change for ${body.repository.full_name} repository reverted`,
    category: ['error', 'repos'],
  };
  emailRender.render(basedir, 'largeTeamProtected', body, (renderError, mailContent) => {
    if (renderError) {
      insights.trackException({
        exception: renderError,
        properties: {
          content: body,
          eventName: 'JobAutomaticTeamsLargeTeamPermissionBlockMailRenderFailure',
        },
      });
      return callback(renderError);
    }
    mail.content = mailContent;
    mailProvider.sendMail(mail, (mailError, mailResult) => {
      const customData: ICustomDataEventName = {
        content: body,
        receipt: mailResult,
      };
      if (mailError) {
        customData.eventName = 'JobAutomaticTeamsLargeTeamPermissionBlockMailFailure';
        insights.trackException({ exception: mailError, properties: customData });
        return callback(mailError);
      }
      insights.trackEvent({ name: 'JobAutomaticTeamsLargeTeamPermissionBlockMailSuccess', properties: customData });
      callback();
    });
  });
}

function createSetTeamPermissionTask(operations, organization, repositoryBody, teamId, necessaryPermission, reason) {
  const repoName = repositoryBody.name;
  const orgName = organization.name;
  const description = `setting permission level ${necessaryPermission} for the team with ID ${teamId} on the repository ${repoName} inside the ${orgName} GitHub org because ${reason}`;
  return callback => {
    const repository = organization.repository(repoName);
    const insights = operations.insights;
    repository.setTeamPermission(teamId, necessaryPermission, error => {
      const eventRoot = 'AutomaticRepoPermissionSet';
      const eventName = eventRoot + error ? 'Success' : 'Failure';
      if (error) {
        error.description = description;
        console.warn(`${eventName} ${description}`);
      } else {
        console.log(`${eventName} ${description}`);
      }
      if (insights) {
        insights.trackEvent({
          name: eventName,
          properties: {
            success: !!error,
            reason: reason,
            description: description,
          },
        });
      }
      return callback(error);
    });
  };
}
