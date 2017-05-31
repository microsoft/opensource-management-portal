//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log", "warn"] }] */

'use strict';

const teamTypes = ['read', 'write', 'admin'];

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

    const [/*specialTeams*/, specials, specialTeamIds, specialTeamLevels] = processOrgSpecialTeams(organization);
    if (specials.length <= 0) {
      return callback();
    }
    const recoveryTasks = [];
    const repositoryBody = data.body.repository;
    const whoChangedIt = data.body.sender.login;

    // New repository
    if (eventType === 'repository' && eventAction === 'created') {
      specialTeamIds.forEach(teamId => {
        const necessaryPermission = specialTeamLevels.get(teamId);
        recoveryTasks.push(createSetTeamPermissionTask(operations, organization, repositoryBody, teamId, necessaryPermission, `a new repository was created by username ${whoChangedIt}, setting automatic permissions`));
      });
    } else if (eventType === 'team') {
      const teamBody = data.body.team;
      const teamId = teamBody.id;
      if (!specialTeamIds.has(teamId)) {
        return callback();
      }
      const necessaryPermission = specialTeamLevels.get(teamId);
      if (!necessaryPermission) {
        return callback(new Error(`No ideal permission level found for the team ${teamId}.`));
      }
      if (eventAction === 'removed_from_repository') {
        // Someone removed the entire team
        recoveryTasks.push(createSetTeamPermissionTask(operations, organization, repositoryBody, teamId, necessaryPermission, `the team and its permission were removed by the username ${whoChangedIt}`));
      } else if (eventAction === 'edited') {
        // The team no longer has the appropriate permission level
        const newPermissions = repositoryBody.permissions;
        if (newPermissions[necessaryPermission] !== true) {
          recoveryTasks.push(createSetTeamPermissionTask(operations, organization, repositoryBody, teamId, necessaryPermission, `the permission was downgraded by the username ${whoChangedIt}`));
        }
      }
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
  },
};

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
