//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Job 16: cleanup invites

// Organization invitations cleanup: remove any invitations that are older than a
// set period of time from the organization.

import { GitHubOrganizationInvite, IProviders } from '../interfaces';
import job from '../job';
import { daysInMilliseconds } from '../lib/utils';

const defaultMaximumInvitationAgeDays = 4;

job.runBackgroundJob(cleanup, {
  timeoutMinutes: 90,
  insightsPrefix: 'JobOrganizationInvitationsCleanup',
});

async function cleanup(providers: IProviders) {
  const insights = providers.insights;
  let maximumInvitationAgeDays = defaultMaximumInvitationAgeDays;
  const { config, operations } = providers;
  if (config?.github?.jobs?.cleanup?.maximumInvitationAgeDays) {
    maximumInvitationAgeDays = config.github.jobs.cleanup.maximumInvitationAgeDays;
  }
  const maximumAgeDate = new Date(new Date().getTime() - daysInMilliseconds(maximumInvitationAgeDays));
  const organizations = operations.getOrganizations();
  const removedInvitations = 0;
  for (const organization of organizations) {
    let invitations: GitHubOrganizationInvite[];
    try {
      invitations = await organization.getMembershipInvitations();
    } catch (getInvitationsError) {
      insights?.trackException({ exception: getInvitationsError });
      console.dir(getInvitationsError);
      continue;
    }
    if (!invitations || invitations.length === 0) {
      continue;
    }
    const invitationsToRemove: string[] = [];
    let emailInvitations = 0;
    for (let i = 0; i < invitations.length; i++) {
      const invite = invitations[i];
      const createdAt = new Date(invite.created_at);
      if (createdAt < maximumAgeDate) {
        if (invite.login) {
          invitationsToRemove.push(invite.login);
        } else {
          ++emailInvitations;
          console.warn(`An e-mail based invitation to ${invite.email} cannot be automatically canceled`);
        }
        const data = {
          createdAt: createdAt.toISOString(),
          login: invite.login,
          inviter: invite && invite.inviter && invite.inviter.login ? invite.inviter.login : undefined,
          role: invite.role,
          emailInvited: invite.email,
        };
        const eventName = invite.login
          ? 'JobOrganizationInviteCleanupInvitationNeeded'
          : 'JobOrganizationInviteCleanupInvitationNotUser';
        insights?.trackEvent({
          name: eventName,
          properties: data,
        });
      }
    }
    console.log(
      `Organization ${organization.name} has ${invitationsToRemove.length} expired invitations out of ${invitations.length} total invitations pending`
    );
    if (emailInvitations) {
      console.warn(
        `Organization ${organization.name} has ${emailInvitations} e-mail based invitations that cannot be canceled through this job`
      );
    }
    for (const login of invitationsToRemove) {
      try {
        await organization.removeMember(login);
      } catch (removeError) {
        insights?.trackException({ exception: removeError });
        insights?.trackEvent({
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
  insights?.trackMetric({ name: 'JobOrganizationInvitationsExpired', value: removedInvitations });
}
