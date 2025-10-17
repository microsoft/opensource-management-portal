//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Job 18: cleanup team requests

// Remove any team requests made by people who are no longer linked.

import { IProviders } from '../interfaces/index.js';
import job from '../job.js';
import { TeamApprovalDecision } from '../routes/org/team/approval/index.js';
import { CreateError } from '../lib/transitional.js';

const INSIGHTS_PREFIX = 'JobTeamRequestsCleanup';

job.runBackgroundJob(cleanup, {
  timeoutMinutes: 5,
  insightsPrefix: INSIGHTS_PREFIX,
});

async function cleanup(providers: IProviders) {
  const { approvalProvider, insights, linkProvider } = providers;
  insights?.trackEvent({
    name: `${INSIGHTS_PREFIX}Start`,
    properties: {
      time: new Date(),
    },
  });
  if (!approvalProvider) {
    throw CreateError.InvalidParameters('No approval provider instance available');
  }

  const linkedCorporateIds = await linkProvider.getAllCorporateIds();

  let approvals = await approvalProvider.queryAllApprovals();
  approvals = approvals.filter((approval) => approval.active === true && approval.corporateId);

  const orphanApprovals = approvals.filter((approval) => !linkedCorporateIds.includes(approval.corporateId));

  let removedRequests = 0;
  let i = 0;
  for (const approval of orphanApprovals) {
    ++i;
    try {
      approval.active = false;
      approval.decision = TeamApprovalDecision.Deny;
      approval.decisionMessage = 'Requestor not linked';
      await approvalProvider.updateTeamApprovalEntity(approval);
      insights?.trackEvent({
        name: 'JobTeamRequestsCleanupApprovalUpdate',
        properties: {
          approvalId: approval.approvalId,
        },
      });
      console.log(
        `Denied former linked user request ${approval.approvalId} (${i} of ${orphanApprovals.length})`
      );
      ++removedRequests;
    } catch (error) {
      insights?.trackException({
        exception: error,
        properties: {
          eventName: 'JobTeamRequestsCleanupApprovalUpdateFailed',
          approvalId: approval.approvalId,
        },
      });
      console.warn(`Error ${error.message} updating approval ${approval.approvalId}`);
    }
  }
  console.log(`Job finishing. Removed ${removedRequests} requests from former linked users.`);
  insights?.trackMetric({ name: 'JobFormerRequestsDenied', value: removedRequests });
  insights?.trackEvent({
    name: `${INSIGHTS_PREFIX}End`,
    properties: {
      time: new Date(),
    },
  });
}
