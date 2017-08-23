//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

'use strict';

const async = require('async');
const moment = require('moment');
const os = require('os');

// Organization invitations cleanup: remove any invitations that are older than a
// set period of time from the organization.

const maxParallelism = 1;
const defaultMaximumInvitationAgeDays = 7;

module.exports = function run(started, startedString, config) {
  console.log(`Job started ${startedString}`);

  const app = require('../../app');
  config.skipModules = new Set([
    'ossDbProvider',
    'web',
  ]);

  app.initializeApplication(config, null, error => {
    if (error) {
      throw error;
    }
    const insights = app.settings.appInsightsClient;
    if (!insights) {
      throw new Error('No app insights client available');
    }

    let maximumInvitationAgeDays = defaultMaximumInvitationAgeDays;
    if (config.github && config.github.jobs && config.github.jobs.cleanup && config.github.jobs.cleanup.maximumInvitationAgeDays) {
      maximumInvitationAgeDays = config.github.jobs.cleanup.maximumInvitationAgeDays;
    }

    const maximumAgeMoment = moment().subtract(maximumInvitationAgeDays, 'days');

    insights.trackEvent('JobOrganizationInvitationsCleanupStarted', {
      hostname: os.hostname(),
      maximumDays: maximumInvitationAgeDays.toString(),
    });

    const operations = app.settings.operations;
    const organizations = operations.getOrganizations();

    let removedInvitations = 0;

    async.eachLimit(organizations, maxParallelism, (organization, next) => {
      organization.getMembershipInvitations((getInvitationsError, invitations) => {
        if (getInvitationsError) {
          return next(getInvitationsError);
        }

        if (!invitations || invitations.length === 0) {
          return next();
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
            insights.trackEvent(eventName, data);
          }
        }

        console.log(`Organization ${organization.name} has ${invitationsToRemove.length} expired invitations out of ${invitations.length} total invitations pending`);
        if (emailInvitations) {
          console.warn(`Organization ${organization.name} has ${emailInvitations} e-mail based invitations that cannot be canceled through this job`);
        }

        async.eachLimit(invitationsToRemove, 1, (login, nextInvite) => {
          organization.removeMember(login, removeError => {
            if (removeError) {
              insights.trackException(removeError);
              insights.trackEvent('JobOrganizationInvitationsCleanupInvitationFailed', {
                login: login,
                message: removeError.message,
              });
            }
            return nextInvite();
          });
        }, next);
      });
    }, error => {
      if (error) {
        console.dir(error);
        insights.trackException(error);
        return process.exit(1);
      }

      console.log(`Job finished. Removed ${removedInvitations} expired invitations.`);
      insights.trackMetric('JobOrganizationInvitationsExpired', removedInvitations);
      process.exit(0);
    });
  });
};
