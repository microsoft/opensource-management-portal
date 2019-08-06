//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

import express = require('express');
const router = express.Router();
import async = require('async');

import { ReposAppRequest } from '../transitional';
import { wrapError } from '../utils';
import { Operations, UnlinkPurpose } from '../business/operations';
import { Organization } from '../business/organization';

router.use(function (req: ReposAppRequest, res, next) {
  const memberOfOrganizations = [];
  const operations = req.app.settings.providers.operations as Operations;
  const ghi = req.individualContext.getGitHubIdentity();
  if (!ghi || !ghi.username) {
    return next(new Error('GitHub identity required'));
  }
  const username = req.individualContext.getGitHubIdentity().username;
  async.each(operations.organizations.values(), function (organization: Organization, callback) {
    organization.getMembership(username, function (error, result) {
      let state = null;
      if (result && result.state) {
        state = result.state;
      }
      if (state == 'active' || state == 'pending') {
        memberOfOrganizations.push(organization);
      }
      if (error) {
        // TODO: consider insights here, but we do not want to halt progress
        // on allowing unlink operations
      }
      return callback();
    });
  }, function (error) {
    if (error) {
      return next(error);
    }
    req.currentOrganizationMemberships = memberOfOrganizations;
    next();
  });
});

router.get('/', function (req: ReposAppRequest, res, next) {
  const link = req.individualContext.link;
  const id = req.individualContext.getGitHubIdentity().id;
  const operations = req.app.settings.providers.operations as Operations;
  const account = operations.getAccount(id);
  account.getOperationalOrganizationMemberships((error, currentOrganizationMemberships) => {
    if (error) {
      return next(error);
    }
    if (link && id) {
      return       req.individualContext.webContext.render({
        view: 'unlink',
        title: 'Remove corporate link and organization memberships',
        state: {
          organizations: currentOrganizationMemberships,
        },
      });
    } else {
      return next(new Error('No link could be found.'));
    }
  });
});

router.post('/', function (req: ReposAppRequest, res, next) {
  const id = req.individualContext.getGitHubIdentity().id;
  const operations = req.app.settings.providers.operations as Operations;
  const account = operations.getAccount(id);
  const insights = req.insights;
  const terminationOptions = {
    reason: 'User used the unlink function on the web site',
    purpose: UnlinkPurpose.Self,
  };
  function complete(error: Error, history: string[]) {
    const hadErrors = error ? 'had errors' : 'no';
    let eventData = {
      id: id.toString(),
      hadErrors: hadErrors,
    };
    for (let i = 0; i < history.length; i++) {
      const historyKey = `log${i + 1}`;
      eventData[historyKey] = history[i];
    }
    insights.trackEvent({ name: 'PortalUserUnlink', properties: eventData });
    if (error) {
      return next(wrapError(error, 'You were successfully removed from all of your organizations. However, a minor failure happened during a data housecleaning operation. Double check that you are happy with your current membership status on GitHub.com before continuing.'));
    } else {
      return res.redirect('/signout?unlink');
    }
  }
  operations.terminateLinkAndMemberships(id, terminationOptions).then(history => {
    return complete(null, history);
  }).catch(error => {
    insights.trackException({ exception: error } );
    return complete(error, []);
  });
});

module.exports = router;
