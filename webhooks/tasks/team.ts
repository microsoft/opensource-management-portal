//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["dir", "log"] }] */

'use strict';

import moment = require('moment');

// When teams are added or removed on GitHub, refresh the organization's list of
// teams as well as the cross-organization view of the teams.

module.exports = {
  filter: function (data) {
    let eventType = data.properties.event;
    return eventType === 'team';
  },
  run: function (operations, organization, data, callback) {
    const event = data.body;
    const immediateRefreshOptions = {
      backgroundRefresh: false,
      maxAgeSeconds: 0.01,
    };
    let refresh = false;
    let expectedAfterRefresh = false;
    const teamId = event.team.id;
    if (event.action === 'created') {
      console.log(`team created: ${event.team.name} in organization ${event.organization.login} by ${event.sender.login}`);
      refresh = true;
      expectedAfterRefresh = true;
    } else if (event.action === 'deleted') {
      console.log(`team DELETED: ${event.team.name} in organization ${event.organization.login} by ${event.sender.login}`);
      refresh = true;
    } else {
      console.log('other team condition:');
      console.dir(data);
    }
    if (refresh) {
      const startingRefresh = moment();
      organization.getTeams(immediateRefreshOptions, () => {
        console.log('refreshing teams list after add or remove operations');
        const now = moment();
        const elapsedSeconds = Math.ceil(moment.duration(now.diff(startingRefresh)).asSeconds());
        console.log(`elapsed seconds since kicked off the refresh: ${elapsedSeconds}`);
        const crossOrgRefreshOptions = {
          backgroundRefresh: false,
          maxAgeSeconds: elapsedSeconds || 15,
        };
        operations.getTeams(null, crossOrgRefreshOptions, (crossOrgRefreshError, allTeams) => {
          if (crossOrgRefreshError) {
            console.log('cross-org team refresh encountered an error:');
            console.dir(crossOrgRefreshError);
          } else {
            console.log(`refreshed cross-org teams list with ${elapsedSeconds} seconds buffer`);
            if (expectedAfterRefresh && allTeams.has(teamId)) {
              console.log('Verified that the team ' + teamId + ' was present in the cross-org result');
            }
          }
        });
      });
    }
    // Immediately, to help delete the ticket
    callback();
  },
};
