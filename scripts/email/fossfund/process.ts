//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log"] }] */

import groupBy from 'lodash/groupBy';

import { IProviders } from "../../../transitional";
import { isEmployeeOrIntern } from "../../../middleware/business/employeesOnly";
import { getOffsetMonthRange, sleep } from "../../../utils";
import { GetAddressFromUpnAsync } from '../../../lib/mailAddressProvider';
import { IMail } from '../../../lib/mailProvider';
import _ from 'lodash';


let painlessConfigResolver = null;
try {
  painlessConfigResolver = require('painless-config-resolver')();
} catch (error) {
  console.log('Painless config resolver initialization error:');
  console.dir(error);
  throw error;
}

painlessConfigResolver.resolve((configurationError, config) => {
  if (configurationError) {
    throw configurationError;
  }
  const app = require('../../../app');
  app.initializeJob(config, null, (error) => {
    if (error) {
      throw error;
    }
    work(config, app).then(done => {
      console.log('done, closing in 10 seconds after any network requests complete...');
      setInterval(() => {
        console.log(done);
        process.exit(0);  
      }, 10000);
    }).catch(error => {
      console.dir(error);
      throw error;
    });
  });
});

async function work(config: any, app): Promise<void> {

  let type1=0, type2=0, type3=0;
  const type1limit = 30000, type2limit = 30000, type3limit = 30000;

  const campaignGroupId = 'fossfund';
  const campaignId = '1';
  const emailViewName = `${campaignGroupId}-${campaignId}`;

  const providers = app.settings.providers as IProviders;
  const { linkProvider, operations, eventRecordProvider, mailAddressProvider, campaignStateProvider } = providers;
  const { start, end } = getOffsetMonthRange();
  let employees = (await linkProvider.getAll())
    .filter(resource => isEmployeeOrIntern(resource.corporateUsername))
    .filter(resource => !resource.isServiceAccount);
  // employees = _.shuffle(employees);
  let i = 0;
  for (const employee of employees) {
    ++i;
    try {
      const corporateId = employee.corporateId;
      if (type1 > type1limit && type2 > type2limit && type3 > type3limit) {
        continue; // totally done
      }
      const state = await campaignStateProvider.getState(corporateId, campaignGroupId, campaignId);
      if (state.optOut) {
        console.log(`employee id=${corporateId} has opted out of the campaign group=${campaignGroupId}`);
        continue;
      }
      if (state.sent) {
        // console.log(`${i}.`);
        // console.log(`mail has already been sent too id=${corporateId}`);
        // console.log('fixing a bug to an already-sent-through for ' + employee.corporateUsername);
        // await campaignStateProvider.setSent(corporateId, campaignGroupId, campaignId);
        // await campaignStateProvider.deleteOops(corporateId, campaignGroupId);
        await sleep(5);
        continue;
      }
      await sleep(250);
      const events = await eventRecordProvider.queryOpenContributionEventsByDateRangeAndThirdPartyId(
        employee.thirdPartyId, 
        start, 
        end, 
        false /* corporate and open source contributions wanted */);
      const openContributions = events.filter(event => event.additionalData.contribution);
      const otherContributionsData = events.filter(event => !event.additionalData.contribution);
      const contributions = groupBy(openContributions, contrib => contrib.action);
      let contributionMailType = 'opportunity';
      let subjectSubset = 'Introducing the FOSS Fund: Please help Microsoft contribute to open source communities';
      let headline = 'FOSS Fund';
      if (openContributions.length) {
        // Go nominate!
        contributionMailType = 'nominate';
        subjectSubset = 'Introducing the FOSS Fund: Help us give $10,000 to an open source project thanks to YOUR contributions';
        if (type1 > type1limit) {
          continue;
        }
        ++type1;
        // console.log(`${employee.corporateDisplayName}: cool`);
      } else if (otherContributionsData.length) {
        subjectSubset = 'Introducing the FOSS Fund: Help us give $10,000 to an open source project by contributing to an open source community';
        contributionMailType = 'godo';
        if (type2 > type2limit) {
          continue;
        }
        ++type2;
        // Tell them to do more things beyond Microsoft
        // console.log(`${employee.corporateDisplayName}: so close`);
      } else {
        if (type3 > type3limit) {
          continue;
        }
        ++type3;
        // Let them know about the opportunity
        // console.log(`${employee.corporateDisplayName}: opportunity`);
      }

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
          notification: 'information',
          app: `Microsoft Open Source`,

          contributionMailType,
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
      console.log(`${employee.corporateUsername} ${type1}/${type1limit} ${type2}/${type2limit} ${type3}/${type3limit} `);
      await sleep(500);
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
}
