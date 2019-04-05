//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["dir", "log"] }] */

'use strict';

module.exports = {
  filter: function (data) {
    let eventType = data.properties.event;
    return eventType === 'repository';
  },
  run: function (operations, organization, data, callback) {
    const event = data.body;
    const immediateRefreshOptions = {
      backgroundRefresh: false,
      maxAgeSeconds: 0.01,
    };
    let update = false;
    if (event.action === 'created') {
      console.log(`repo created: ${event.repository.full_name} ${event.repository.private === 'private' ? 'private' : 'public'} by ${event.sender.login}`);
      update = true;
    } else if (event.action === 'deleted') {
      console.log(`repo DELETED: ${event.repository.full_name} ${event.repository.private === 'private' ? 'private' : 'public'} by ${event.sender.login}`);
      update = true;
    } else if (event.action === 'publicized') {
      console.log('a repo went public!');
      // TODO: refresh repos list here, too
      // TODO: refresh the specific repo entry
    } else {
      console.log('other repo condition:');
      console.dir(data);
    }
    if (update) {
      // CONSIDER: When to update the entire org list? operations.getRepos() would be cross-org
      organization.getRepositories(immediateRefreshOptions, () => {
        console.log('refreshed repos list after ADD');
        const crossOrgRefreshOptions = {
          backgroundRefresh: false,
          maxAgeSeconds: 15,
        };
        operations.getRepos(crossOrgRefreshOptions, () => {
          console.log('refreshed cross-org repos list with 15s buffer');
        });
      });
    }
    // Immediately, to help delete the ticket
    callback();
  },
};
