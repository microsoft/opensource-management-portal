//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["dir", "log"] }] */

'use strict';

import { Operations } from "../../business/operations";
import { Organization } from "../../business/organization";

module.exports = {
  filter: function (data) {
    let eventType = data.properties.event;
    return eventType === 'organization';
  },
  run: function (operations: Operations, organization: Organization, data, callback) {
    const event = data.body;
    let refresh = false;
    if (event.action === 'member_invited') {
      console.log(`org member invite; ghu ${event.invitation.login} role ${event.invitation.role} ghid ${event.invitation.id} org: ${event.organization.login}`);
    } else if (event.action === 'member_added') {
      console.log(`org member added; ghu ${event.membership.user.login} role ${event.membership.role} state ${event.membership.state} ghid ${event.membership.user.id} org: ${event.organization.login}`);
      refresh = true;
    } else if (event.action === 'member_removed') {
      console.log(`org member REMOVED; ghu ${event.membership.user.login} role ${event.membership.role} state ${event.membership.state} ghid ${event.membership.user.id} org: ${event.organization.login}`);
      refresh = true;
    } else {
      console.dir(data);
    }
    if (refresh) {
      const orgName = organization.name;
      console.log(`refreshing ${orgName} org members list`);
      const immediateRefreshOptions = {
        backgroundRefresh: false,
        maxAgeSeconds: 0.01,
      };
      return organization.getMembers(immediateRefreshOptions).then(ok => {
        console.log(`refreshed membership list for the org ${orgName}, will refresh x-org immediately`);
        return operations.getMembers(immediateRefreshOptions).then(done => {
          console.log('refreshed x-org memberships');
        });
      }).catch(error => {
        // ignore error
        return callback();
      });
    }
    callback();
  },
};
