//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["dir", "log"] }] */

'use strict';

module.exports = {
  filter: function (data) {
    let eventType = data.properties.event;
    return eventType === 'membership';
  },
  run: function (operations, organization, data, callback) {
    if (data.body.action && data.body.scope && data.body.member.login && data.body.member.id) {
      console.log(`${data.body.organization.login} ${data.body.scope} membership: ${data.body.action} ${data.body.scope} ${data.body.member.login} ${data.body.member.id} team ${data.body.team.id} ${data.body.team.name}`);

      // update the team in question

      /*
      const immediateRefreshOptions = {
        backgroundRefresh: false,
        maxAgeSeconds: 0,
      };
      */
      console.log(`refreshing members in the team ${data.body.team.name} ${data.body.team.id} list`);
      const team = organization.team(data.body.team.id);
      // TODO: get team members
      team.getDetails();
      team.getMembers({
        backgroundRefresh: false,
        maxAgeSeconds: 0.1,
      }, (getMembersError, members) => {
        let num = '';
        if (!getMembersError && members && members.length) {
          num = members.length;
        }
        console.log(`refreshed ${num} team members, getting maintainers`);
        team.getMembers({
          role: 'maintainer',
          backgroundRefresh: false,
          maxAgeSeconds: 0.1,
        }, (getMaintainersError, maintainers) => {
          let num2 = '';
          if (!getMaintainersError && maintainers && maintainers.length) {
            num2 = members.length;
          }
          console.log(`refreshed ${num2} team maintainers`);
        });
      });
    } else {
      console.dir(data);
    }
    callback();
  },
};
