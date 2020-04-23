//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log"] }] */

import _ from 'lodash';

import app, { IReposJob } from '../../../app';
import { isEmployeeOrIntern } from "../../../middleware/business/employeesOnly";
import { getOffsetMonthRange, sleep, quitInTenSeconds } from "../../../utils";
import { GetAddressFromUpnAsync } from '../../../lib/mailAddressProvider';
import { IMail } from '../../../lib/mailProvider';

app.runJob(async function work({ providers }: IReposJob) {
  let runLimit = 45000;
  let inRun = 0;
  const campaignGroupId = 'fossfund';
  const campaignId = '2'; // 2 = first voting campaign
  const emailViewName = `${campaignGroupId}-${campaignId}`;
  const { linkProvider, operations, eventRecordProvider, electionProvider, electionNominationProvider, mailAddressProvider, campaignStateProvider } = providers;
  const { start, end } = getOffsetMonthRange(-1);
  const election = (await electionProvider.queryElectionsByEligibilityDates(start, end))[0];
  const nominees = await electionNominationProvider.queryApprovedElectionNominees(election.electionId);
  let employees = (await linkProvider.getAll())
    .filter(resource => isEmployeeOrIntern(resource.corporateUsername))
    .filter(resource => !resource.isServiceAccount);
  employees = _.shuffle(employees);
  let i = 0;
  for (const employee of employees) {
    ++i;
    try {
      const corporateId = employee.corporateId;
      if (inRun > runLimit) {
        continue;
      }
      ++inRun;
      const state = await campaignStateProvider.getState(corporateId, campaignGroupId, campaignId);
      if (state.optOut) {
        console.log(`employee id=${corporateId} has opted out of the campaign group=${campaignGroupId}`);
        continue;
      }
      if (state.sent) {
        await sleep(5);
        continue;
      }
      await sleep(5);
      const events = await eventRecordProvider.queryOpenContributionEventsByDateRangeAndCorporateId(
        employee.corporateId,
        start, 
        end, 
        false /* corporate and open source contributions wanted */);
      const openContributions = events.filter(event => event.additionalData.contribution);
      if (openContributions.length === 0) {
        // not an open source contributor for the election
        // mark this as "sent" to skip in the future
        await campaignStateProvider.setSent(corporateId, campaignGroupId, campaignId);
        continue;
      }
      const otherContributionsData = events.filter(event => !event.additionalData.contribution);
      const contributions = _.groupBy(openContributions, contrib => contrib.action);
      let subjectSubset = 'FOSS Fund voting is now open: Let\'s give $10,000 to a project thanks to YOUR contributions!';
      let headline = 'FOSS Fund';
      const address = await GetAddressFromUpnAsync(mailAddressProvider, employee.corporateUsername);
      if (!address) {
        console.log(`No e-mail address for ${employee.corporateUsername}`);
        continue;
      }
      const email: IMail = {
        to: address,
        bcc: 'jeff.wilcox@microsoft.com',
        subject: subjectSubset,
        content: await operations.emailRender(emailViewName, {
          reason: (`This mail was sent to ${address} for the GitHub user ${employee.thirdPartyUsername} linked to ${employee.corporateDisplayName}`),
          unsubscribeText: 'Opt-out of future FOSS Fund emails',
          unsubscribeLink: `https://repos.opensource.microsoft.com/settings/campaigns/${campaignGroupId}/unsubscribe`,
          headline,
          election,
          nominees: _.shuffle(nominees),
          notification: 'information',
          app: `Microsoft Open Source`,
          employee,
          openContributions,
          contributions,
          otherContributionsData,
        }),
      };
      await campaignStateProvider.setSent(corporateId, campaignGroupId, campaignId);
      await operations.sendMail(email);
      console.log(`OK sent to ${corporateId} and set state for ${employee.corporateUsername} ${employee.corporateDisplayName}`);
      //console.log(`OK sent to ${corporateId} and didn't state *** for ${employee.corporateUsername} ${employee.corporateDisplayName}`);
      console.log(`${employee.corporateUsername} ${inRun}/${runLimit}`);
      await sleep(10);
      if (i % 100 === 0) {
        console.log();
        console.log('long sleep...');
        await sleep(5000);
        console.log('moving along...');
        console.log();
      }
    } catch (processEmployeeError) {
      console.dir(processEmployeeError);
    }
  }
});
