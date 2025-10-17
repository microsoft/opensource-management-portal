//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Webhook firehose processing specific to repos

import os from 'os';
import { DateTime } from 'luxon';

import ProcessOrganizationWebhook, {
  GitHubWebhookProperties,
} from '../business/webhooks/organizationProcessor.js';
import { sleep } from '../lib/utils.js';
import getCompanySpecificDeployment from '../middleware/companySpecificDeployment.js';
import job from '../job.js';

import type { IQueueMessage } from '../lib/queues/index.js';
import type {
  IGitHubAppInstallation,
  IGitHubWebhookEnterprise,
  IProviders,
  IReposJob,
  IReposJobResult,
} from '../interfaces/index.js';

const runningAsOngoingDeployment = true;

const hardAbortMs = 1000 * 60 * 5; // 5 minutes

const EVENTS_TO_COMPLETELY_IGNORE = ['installation', 'ping', 'star', 'watch'];
const USER_ACTIONS_TO_HANDLE = ['transferred', 'created'];
const EVENTS_TO_ALWAYS_HANDLE = ['repository_advisory'];

job.run(firehose, {
  insightsPrefix: 'JobFirehose',
});

async function firehose(providers: IProviders, { started }: IReposJob): Promise<IReposJobResult> {
  const processedEventTypes = {};
  const interestingEvents = 0;
  let processedEvents = 0;
  const config = providers.config;
  const jobMinutesFrequency = config.github.webhooks.runtimeMinutes
    ? parseInt(config.github.webhooks.runtimeMinutes)
    : 5;
  const runtimeSeconds =
    (jobMinutesFrequency - 1) * 60 + 30; /* 30 second flex in the last minute instead of 60s */
  if (config.github?.webhooks?.serviceBus?.queue) {
    console.log(`bus: ${config.github.webhooks.serviceBus.queue}`);
  }
  if (runningAsOngoingDeployment) {
    console.log('webhook processor is configured to keep running, it will not exit');
  } else {
    setTimeout(() => {
      const finishing = DateTime.utc().toISO();
      console.log(
        `Ending run after ${runtimeSeconds}s at ${finishing} after finding ${interestingEvents} events of interest and processing ${processedEvents}`
      );
      console.dir(processedEventTypes);
      process.exit(0);
    }, runtimeSeconds * 1000);
  }

  while (config?.github?.webhooks?.firehoseOffline) {
    console.warn(`FIREHOSE OFFLINE: ${config.github.webhooks.firehoseOffline}`);
    await sleep(1000 * 60 * 5);
  }

  const maxParallelism = config.github.webhooks.parallelism
    ? parseInt(config.github.webhooks.parallelism)
    : 2;
  const emptyQueueDelaySeconds = config.github.webhooks.emptyQueueDelaySeconds
    ? parseInt(config.github.webhooks.emptyQueueDelaySeconds)
    : 10;

  if (runningAsOngoingDeployment) {
    console.log(
      `Webhooks processor started ${started} and will run with empty delays of ${emptyQueueDelaySeconds}s`
    );
  } else {
    console.log(
      `Job started ${started} and will run for ${runtimeSeconds}s with empty delays of ${emptyQueueDelaySeconds}s`
    );
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
  const supportsMultipleThreads = webhookQueueProcessor.supportsMultipleThreads;
  if (!supportsMultipleThreads) {
    console.log('The queue provider does not support multiple concurrent threads');
  }
  const parallelism = supportsMultipleThreads ? maxParallelism : 1;
  const sliceDelayPerThread = emptyQueueDelaySeconds / parallelism;
  console.log(
    `Parallelism for this run will be ${parallelism} logical threads, offset by ${sliceDelayPerThread}s`
  );
  insights?.trackEvent({
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
  const threads: Promise<void>[] = [];
  let delay = 0;
  for (let i = 0; i < parallelism; i++) {
    threads.push(createThread(providers, i, delay));
    delay += sliceDelayPerThread;
  }
  await Promise.all(threads);

  console.warn('Forever execution thread has completed.');
  return {};

  // -- end of job startup --

  async function createThread(
    providers: IProviders,
    threadNumber: number,
    startupDelay: number
  ): Promise<void> {
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
      const insights = providers.insights;
      insights.trackException({ exception: error });
      insights.trackEvent({
        name: 'JobFirehoseFatalError',
        properties: {
          message: error.message,
        },
      });
    }
  }

  async function iterate(providers: IProviders, threadNumber: number): Promise<void> {
    const { webhookQueueProcessor } = providers;
    let messages: IQueueMessage[] = null;
    let intervalHandle = setTimeout(hardAbort, hardAbortMs);
    try {
      messages = await webhookQueueProcessor.receiveMessages();
    } catch (getError) {
      clearTimeout(intervalHandle);
      console.dir(getError);
      await sleep(emptyQueueDelaySeconds * 1000 * 5);
      return;
    }
    clearTimeout(intervalHandle);
    if (!messages || messages.length === 0) {
      console.log(
        `[${threadNumber}] [empty queue ${new Date().toISOString()}] peek in ${emptyQueueDelaySeconds}s`
      );
      await sleep(emptyQueueDelaySeconds * 1000);
      return;
    }
    intervalHandle = setTimeout(hardAbort, hardAbortMs);
    try {
      for (const message of messages) {
        try {
          await handle(providers, message);
        } catch (handleError) {
          console.dir(handleError);
          await sleep(emptyQueueDelaySeconds * 1000);
        }
      }
    } catch (timeoutError) {
      console.warn(timeoutError);
    } finally {
      clearTimeout(intervalHandle);
    }
  }

  async function handle(providers: IProviders, message: IQueueMessage): Promise<void> {
    const { operations, insights, webhookQueueProcessor } = providers;
    let totalSeconds: number = null;
    const logicAppStarted = message.customProperties.started
      ? DateTime.fromISO(message.customProperties.started)
      : null;
    if (logicAppStarted) {
      totalSeconds = DateTime.utc().diff(logicAppStarted, 'seconds').seconds;
      insights.trackMetric({ name: 'JobFirehoseQueueDelay', value: totalSeconds });
    }
    let deletedAlready = false;

    const webhook = message.body as any;
    const eventType = message.customProperties['event'] || '';
    const action = webhook?.action || '';
    const installation = webhook.installation as IGitHubAppInstallation;
    const enterprise = webhook.enterprise as IGitHubWebhookEnterprise;

    const acknowledgeEvent = function () {
      if (deletedAlready) {
        console.warn(
          `\t\t\t\t\t[message ${message.identifier} was already deleted] [start latency ${totalSeconds}s] event=${eventType} action=${action}`
        );
        return;
      }
      deletedAlready = true;
      console.log(
        `\t\t\t\t\t[message ${message.identifier}] deleted [start latency ${totalSeconds}s] event=${eventType} action=${action}`
      );
      webhookQueueProcessor
        .deleteMessage(message)
        .then((ok) => {
          ++processedEvents;
        })
        .catch((deleteError) => {
          console.dir(deleteError);
        });
    };

    let organization = null;
    let orgName = null;
    if (EVENTS_TO_ALWAYS_HANDLE.includes(eventType)) {
      // always process these events
    } else if (EVENTS_TO_COMPLETELY_IGNORE.includes(eventType)) {
      acknowledgeEvent();
      return;
    } else if (webhook?.sender?.type === 'User' && !USER_ACTIONS_TO_HANDLE.includes(action)) {
      acknowledgeEvent();
      insights?.trackEvent({
        name: 'job.webhook.event.user_type.ignored',
        properties: {
          eventType,
          action,
          target_type: installation?.target_type || '',
        },
      });
      console.log(
        `Ignored user event ${message.identifier}: event=${eventType} action=${action} target_type=${installation?.target_type || ''}`
      );
      return;
    }
    const deployment = getCompanySpecificDeployment();
    const processedElsewhere = deployment?.features?.firehose?.processWebhook
      ? await deployment.features.firehose.processWebhook(
          providers,
          webhook,
          eventType,
          enterprise,
          installation,
          acknowledgeEvent
        )
      : false;
    if (processedElsewhere === true) {
      console.log(`[the webhook was processed by a company-specific handler: ${message.identifier}]`);
      acknowledgeEvent();
      return;
    }
    if (installation) {
      if (installation.target_type && installation.target_type === 'Organization') {
        const id = installation.target_id;
        try {
          const orgById = operations.getOrganizationById(id);
          orgName = orgById.name;
        } catch (notConfiguredById) {
          console.log(`not configured: org ID ${id}`);
          acknowledgeEvent();
          return;
        }
      } else if (installation.target_type) {
        console.log(`invalid target type ${installation.target_type} for installation id=${installation.id}`);
        acknowledgeEvent();
        return;
      }
    }
    if (!orgName && webhook.organization) {
      orgName = webhook.organization ? webhook.organization.login : null;
    }
    if (!orgName) {
      acknowledgeEvent();
      throw new Error('No organization.login present in the event body');
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
      providers,
      organization,
      event: {
        properties: message.customProperties as unknown as GitHubWebhookProperties,
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

function hardAbort() {
  console.warn(`Extremely long time elapsed, hard-aborting the process at ${new Date()}`);
  process.exit(1);
}
