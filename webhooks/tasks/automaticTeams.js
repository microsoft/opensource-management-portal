//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log", "warn"] }] */

'use strict';

const teamTypes = ['read', 'write', 'admin'];
const defaultLargeAdminTeamSize = 100;

const async = require('async');

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
    if (eventType === 'team' && (eventAction === 'add_repository' || eventAction === 'added_to_repository')) {
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
  run: function (operations, organization, data, callback) {
    const eventType = data.properties.event;
    const eventAction = data.body.action;

    const [/*specialTeams*/, /*specials*/, specialTeamIds, specialTeamLevels] = processOrgSpecialTeams(organization);
    const preventLargeTeamPermissions = organization.preventLargeTeamPermissions;
    const recoveryTasks = [];
    const repositoryBody = data.body.repository;
    const newPermissions = repositoryBody ? repositoryBody.permissions : null;
    const whoChangedIt = data.body && data.body.sender ? data.body.sender.login : null;

    function finalizeEventRemediation(immediateError) {
      if (immediateError) {
        return callback(immediateError);
      }
      if (recoveryTasks.length <= 0) {
        return callback();
      }
      async.waterfall(recoveryTasks, (error) => {
        const insights = operations.insights;
        if (error) {
          insights.trackException(error);
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
        } else if (eventAction === 'removed_from_repository') {
          // Someone removed the entire team
          recoveryTasks.push(createSetTeamPermissionTask(operations, organization, repositoryBody, teamId, necessaryPermission, `the team and its permission were removed by the username ${whoChangedIt}`));
        }
        return finalizeEventRemediation();
      }

      // Prevent granting large teams access
      if (preventLargeTeamPermissions) {
        return getTeamSize(organization, teamId, (getTeamError, teamSize) => {
          if (getTeamError) {
            return callback(getTeamError);
          }
          if (eventAction === 'added_to_repository') {
            return checkAddedRepositoryPreventionNeed(recoveryTasks, operations, organization, repositoryBody, teamId, whoChangedIt, teamSize, preventLargeTeamPermissions, finalizeEventRemediation);
          } else if (eventAction === 'edited') {
            const specificReason = teamTooLargeForPurpose(teamId, newPermissions.admin, newPermissions.push, organization, teamSize, preventLargeTeamPermissions);
            if (specificReason) {
              // This permission grant is too large and should be decreased
              addLargeTeamPermissionRevertTasks(recoveryTasks, operations, organization, repositoryBody, teamId, whoChangedIt, specificReason);
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
  let isBroadAccessTeam = broadAccessTeams && broadAccessTeams.indexOf(teamId) >= 0;
  if (isBroadAccessTeam && (isAdmin || isPush)) {
    return 'The team is a very broad access team and does not allow push or admin access';
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

function checkAddedRepositoryPreventionNeed(recoveryTasks, operations, organization, repositoryBody, teamId, whoChangedIt, teamSize, preventLargeTeamPermissions, finalizeEventRemediation) {
  // GitHub API issue reported 6/8/17, no visibility in the webhook event for the permission, and if the API is used, it is not always 'pull' only
  const team = organization.team(teamId);
  const name = repositoryBody.name;
  return team.checkRepositoryPermission(name, (error, permissions) => {
    if (permissions) {
      const specificReason = teamTooLargeForPurpose(teamId, permissions.admin, permissions.push, organization, teamSize, preventLargeTeamPermissions);
      if (specificReason) {
        // This permission grant is too large and should be decreased
        addLargeTeamPermissionRevertTasks(recoveryTasks, operations, organization, repositoryBody, teamId, whoChangedIt, specificReason);
      }
    }
    return finalizeEventRemediation(error);
  });
}

function addLargeTeamPermissionRevertTasks(recoveryTasks, operations, organization, repositoryBody, teamId, whoChangedIt, specificReason) {
  specificReason = specificReason ? ': ' + specificReason : '';
  const blockReason = `the permission was upgraded by ${whoChangedIt} but a large team permission prevention feature has reverted the change${specificReason}`;
  console.log(blockReason);
  const insights = operations.insights;
  insights.trackMetric('JobAutomaticTeamsLargeTeamPermissionBlock', 1);
  insights.trackEvent('JobAutomaticTeamsLargeTeamPermissionBlocked', {
    specificReason: specificReason,
    teamId: teamId,
    organization: organization.name,
    repository: repositoryBody.name,
    whoChangedIt: whoChangedIt,
  });
  recoveryTasks.push(createSetTeamPermissionTask(operations, organization, repositoryBody, teamId, 'pull', blockReason));
  recoveryTasks.push(createLargeTeamPermissionPreventionWarningMailTask(operations, organization, repositoryBody, teamId, blockReason));
}

function createLargeTeamPermissionPreventionWarningMailTask(operations, organization, repositoryBody, teamId, reason) {
  // TODO: Implement informational event if there is a mail provider available
  return callback => {
    return callback(null, reason);
  };
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
        insights.trackEvent(eventName, {
          success: !!error,
          reason: reason,
          description: description,
        });
      }
      return callback(error);
    });
  };
}
