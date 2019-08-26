//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

'use strict';

import async = require('async');
import moment from 'moment';
import { Organization } from '../../business/organization';
import { Operations } from '../../business/operations';
const os = require('os');

// Organization invitations cleanup: remove any invitations that are older than a
// set period of time from the organization.

const maxParallelism = 1;
const defaultMaximumInvitationAgeDays = 7;

module.exports = function run(started, startedString, config) {
  console.log(`Job started ${startedString}`);

  const app = require('../../app');
  config.skipModules = new Set([
    'web',
  ]);

  app.initializeJob(config, null, error => {
    if (error) {
      throw error;
    }
    const insights = app.settings.appInsightsClient;
    if (!insights) {
      throw new Error('No app insights client available');
    }
    cleanup(config, app, insights).then(done => {
      console.log('done');
      process.exit(0);
    }).catch(error => {
      if (insights) {
        insights.trackException({ exception: error, properties: { name: 'JobCleanupInvitesFailure' } });
      }
      console.dir(error);
      throw error;
    });
  });
}

async function cleanup(config, app, insights) : Promise<void> {
  let maximumInvitationAgeDays = defaultMaximumInvitationAgeDays;
  if (config.github && config.github.jobs && config.github.jobs.cleanup && config.github.jobs.cleanup.maximumInvitationAgeDays) {
    maximumInvitationAgeDays = config.github.jobs.cleanup.maximumInvitationAgeDays;
  }

  const maximumAgeMoment = moment().subtract(maximumInvitationAgeDays, 'days');

  insights.trackEvent({
    name: 'JobOrganizationInvitationsCleanupStarted',
    properties: {
      hostname: os.hostname(),
      maximumDays: maximumInvitationAgeDays.toString(),
    },
  });

  const operations = app.settings.operations as Operations;
  const organizations = operations.getOrganizations();

  let removedInvitations = 0;

  for (let organization of organizations) {
    let invitations: any[];
    try {
      invitations = await organization.getMembershipInvitations();
    } catch (getInvitationsError) {
      insights.trackException({ exception: getInvitationsError });
      console.dir(getInvitationsError);
      continue;
    }
    if (!invitations || invitations.length === 0) {
      continue;
    }
    const invitationsToRemove = [];
    let emailInvitations = 0;
    for (let i = 0; i < invitations.length; i++) {
      const invite = invitations[i];
      const createdAt = moment(invite.created_at);
      if (createdAt.isBefore(maximumAgeMoment)) {
        if (invite.login) {
          invitationsToRemove.push(invite.login);
        } else {
          ++emailInvitations;
          console.warn(`An e-mail based invitation to ${invite.email} cannot be automatically canceled`);
        }
        const data = {
          createdAt: createdAt.format(),
          invitedAgo: createdAt.fromNow(),
          login: invite.login,
          inviter: invite && invite.inviter && invite.inviter.login ? invite.inviter.login : undefined,
          role: invite.role,
          emailInvited: invite.email,
        };
        const eventName = invite.login ? 'JobOrganizationInviteCleanupInvitationNeeded' : 'JobOrganizationInviteCleanupInvitationNotUser';
        insights.trackEvent({
          name: eventName,
          properties: data,
        });
      }
    }
    console.log(`Organization ${organization.name} has ${invitationsToRemove.length} expired invitations out of ${invitations.length} total invitations pending`);
    if (emailInvitations) {
      console.warn(`Organization ${organization.name} has ${emailInvitations} e-mail based invitations that cannot be canceled through this job`);
    }
    for (let login of invitationsToRemove) {
      try {
        await organization.removeMember(login);
      } catch (removeError) {
        insights.trackException({ exception: removeError });
        insights.trackEvent({
          name: 'JobOrganizationInvitationsCleanupInvitationFailed',
          properties: {
            login: login,
            message: removeError.message,
          },
        });
      }
    }
  }
  console.log(`Job finishing. Removed ${removedInvitations} expired invitations.`);
  insights.trackMetric({ name: 'JobOrganizationInvitationsExpired', value: removedInvitations });
}
