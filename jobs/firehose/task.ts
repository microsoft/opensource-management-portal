//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

// Webhook firehose processing specific to repos

import moment from 'moment';
import os from 'os';

import App, { IReposJob, IReposJobResult } from '../../app';

import ProcessOrganizationWebhook, { IGitHubWebhookProperties } from '../../webhooks/organizationProcessor';
import { IProviders } from '../../transitional';
import { sleep, quitInTenSeconds } from '../../utils';
import { IQueueMessage } from '../../lib/queues';

const runningAsOngoingDeployment = true;

export default async function firehose({ providers, started }: IReposJob): Promise<IReposJobResult> {
  let processedEventTypes = {};
  let interestingEvents = 0;
  let processedEvents = 0;
  const config = providers.config;
  const jobMinutesFrequency = config.github.webhooks.runtimeMinutes ? parseInt(config.github.webhooks.runtimeMinutes) : 5;
  let runtimeSeconds = (jobMinutesFrequency - 1) * 60 + 30 /* 30 second flex in the last minute instead of 60s */;
  if (runningAsOngoingDeployment) {
    console.log('webhook processor is configured to keep running, it will not exit');
  } else {
    setTimeout(() => {
      const finishing = moment().utc().format();
      console.log(`Ending run after ${runtimeSeconds}s at ${finishing} after finding ${interestingEvents} events of interest and processing ${processedEvents}`);
      console.dir(processedEventTypes);
      process.exit(0);
    }, runtimeSeconds * 1000);
  }

  const maxParallelism = config.github.webhooks.parallelism ? parseInt(config.github.webhooks.parallelism) : 2;
  const emptyQueueDelaySeconds = config.github.webhooks.emptyQueueDelaySeconds ? parseInt(config.github.webhooks.emptyQueueDelaySeconds) : 10;

  if (runningAsOngoingDeployment) {
    console.log(`Webhooks processor started ${started} and will run with empty delays of ${emptyQueueDelaySeconds}s`);
  } else {
    console.log(`Job started ${started} and will run for ${runtimeSeconds}s with empty delays of ${emptyQueueDelaySeconds}s`);
  }
  const insights = providers.insights;
  const webhooksConfig = config.github.webhooks;
  if (!webhooksConfig) {
    throw new Error('No webhoooks queue configuration');
  }
  const webhookQueueProcessor = providers.webhookQueueProcessor;
  if (!webhookQueueProcessor) {
    throw new Error('No webhookQueueProcessor available');
  }
  // let parallelism = messagesInQueue > maxParallelism / 2 ? maxParallelism : Math.min(5, maxParallelism);
  let parallelism = maxParallelism;
  const sliceDelayPerThread =  emptyQueueDelaySeconds/ parallelism;
  console.log(`Parallelism for this run will be ${parallelism} logical threads, offset by ${sliceDelayPerThread}s`);
  // const insights = app.settings.appInsightsClient;
  if (insights) {
    insights.trackEvent({
      name: 'JobFirehoseStarted',
      properties: {
        hostname: os.hostname(),
        // queue: serviceBusConfig.queue,
        // subscription: serviceBusConfig.subscriptionName,
        // messagesInQueue: messagesInQueue.toString(),
        // deadLetters: deadLetters.toString(),
      },
    });
    // insights.trackMetric({ name: 'FirehoseMessagesInQueue', value: messagesInQueue });
    // insights.trackMetric({ name: 'FirehoseDeadLetters', value: deadLetters });
  }
  const threads: Promise<void>[] = [];
  let delay = 0;
  for (let i = 0; i < parallelism; i++) {
    threads.push(createThread(App, providers, i, delay));
    delay += sliceDelayPerThread;
  }
  let ok = true;
  await Promise.all(threads);

  console.warn('Forever execution thread has completed.');
  return {};

  // -- end of job startup --

  async function createThread(app, providers: IProviders, threadNumber: number, startupDelay: number): Promise<void> {
    if (startupDelay > 0) {
      const ms = startupDelay * 1000;
      console.log(`[thread ${threadNumber}] delay ${ms}ms`);
      await sleep(ms);
    }
    console.log(`[thread ${threadNumber}] started`);
    try {
      while (true) {
        await iterate(providers, threadNumber);
      }
    } catch (error) {
      const insights = app.settings.appInsightsClient;
      insights.trackException({ exception: error });
      insights.trackEvent({
        name:'JobFirehoseFatalError',
        properties: {
          message: error.message,
        },
      });
    }
  }

  async function iterate(providers: IProviders, threadNumber: number): Promise<void> {
    const { webhookQueueProcessor } = providers;
    let messages: IQueueMessage[] = null;
    try {
      messages = await webhookQueueProcessor.receiveMessages();
    } catch (getError) {
      console.dir(getError);
      await sleep(emptyQueueDelaySeconds * 1000);
      return;
    }
    if (!messages || messages.length === 0) {
      console.log(`[${threadNumber}] [empty queue] peek in ${emptyQueueDelaySeconds}s`);
      await sleep(emptyQueueDelaySeconds * 1000);
      return;
    }
    for (const message of messages) {
      try {
        await handle(providers, message);
      } catch (handleError) {
        console.dir(handleError);
      }
    }
  }

  async function handle(providers: IProviders, message: IQueueMessage): Promise<void> {
    const { operations, insights, webhookQueueProcessor } = providers;
    const logicAppStarted = message.customProperties.started ? moment.utc(message.customProperties.started) : null;
    if (logicAppStarted) {
      // const enqueued = lockedMessage && lockedMessage.brokerProperties ? lockedMessage.brokerProperties.EnqueuedTimeUtc : null;
      // const serviceBusDelay = moment.utc(enqueued, 'ddd, DD MMM YYYY HH:mm:ss'); // console.log('delays - bus delay: ' + serviceBusDelay.fromNow() + ', logic app to now: ' + logicAppStarted.fromNow() + ', total ms: ' + totalMs.toString());
      const totalSeconds = moment.utc().diff(logicAppStarted) / 1000;
      insights.trackMetric({ name: 'JobFirehoseQueueDelay', value: totalSeconds });
    }
    const acknowledgeEvent = function () {
      console.log(`[message ${message.identifier}] deleted`);
      webhookQueueProcessor.deleteMessage(message).then(ok => {
        ++processedEvents;
      }).catch(deleteError => {
        console.dir(deleteError);
      });
    };
    const webhook = message.body as any;
    const eventType = message.customProperties['event'] || '';
    let organization = null;
    const installationBody = webhook.installation;
    let orgName = null;
    if (installationBody) {
      if (installationBody.target_type && installationBody.target_type === 'Organization') {
        const id = installationBody.target_id;
        try {
          const orgById = operations.getOrganizationById(id);
          orgName = orgById.name;
        } catch (notConfiguredById) {
          console.log(`not configured: org ID ${id}`);
          acknowledgeEvent();
          return;
        }
      } else if (installationBody.target_type) {
        console.log(`invalid target type ${installationBody.target_type} for installation id=${installationBody.id}`)
        acknowledgeEvent();
        return;
      }
    }
    if (!orgName && webhook.organization) {
      orgName = webhook.organization ? webhook.organization.login : null;
    }
    if (!orgName) {
      acknowledgeEvent();
      if (eventType === 'ping' || eventType === 'installation') {
        // common events
        return;
      } else {
        throw new Error('No organization.login present in the event body');
      }
    }
    try {
      organization = operations.getOrganization(orgName);
    } catch (noOrganizationError) {
      acknowledgeEvent();
      const isKnownOrganization = operations.isIgnoredOrganization(orgName);
      if (isKnownOrganization) {
        // While we receive events for organizations being onboarded or known but ignored,
        // these are not exceptional events, just events to skip.
        insights.trackEvent({
          name: 'JobFirehoseKnownOrganizationIgnored',
          properties: {
            orgName,
          },
        });
      } else {
        insights.trackException({ exception: noOrganizationError });
        insights.trackEvent({
          name: 'JobFirehoseMissingOrganizationConfiguration',
          properties: {
            orgName,
          },
        });
      }
      return;
    }
    const options = {
      operations,
      organization,
      event: {
        properties: (message.customProperties as unknown as IGitHubWebhookProperties),
        rawBody: message.unparsedBody,
        body: message.body,
      },
      acknowledgeValidEvent: acknowledgeEvent,
    };
    try {
      const interestingEvents = await ProcessOrganizationWebhook(options);
      if (interestingEvents && eventType) {
        processedEventTypes[eventType] += interestingEvents;
      }
    } catch (processingError) {
      console.warn('Queue processing error during task phase:');
      console.warn(processingError);
    }
  }
}
