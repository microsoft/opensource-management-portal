//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

'use strict';

// Firehose processing specific to repos

import async = require('async');
import moment = require('moment');
import { Operations } from '../../business/operations';
const os = require('os');
const serviceBus = require('azure-sb');

const organizationWebhookProcessor = require('../../webhooks/organizationProcessor');

module.exports = function runFirehoseTask(started, startedString, config) {
  if (config.webJob.firehose.skip && config.webJob.firehose.skip != '0') {
    console.log('Firehose job is configured to skip execution.');
    process.exit(0);
  }
  let processedEventTypes = {};
  let interestingEvents = 0;
  let processedEvents = 0;
  const jobMinutesFrequency = config.webJob.firehose.runtimeMinutes ? parseInt(config.webJob.firehose.runtimeMinutes) : 5;
  let runtimeSeconds = (jobMinutesFrequency - 1) * 60 + 30 /* 30 second flex in the last minute instead of 60s */;
  setTimeout(() => {
    const finishing = moment().utc().format();
    console.log(`Ending run after ${runtimeSeconds}s at ${finishing} after finding ${interestingEvents} events of interest and processing ${processedEvents}`);
    console.dir(processedEventTypes);
    process.exit(0);
  }, runtimeSeconds * 1000);

  const maxParallelism = config.webJob.firehose.parallelism ? parseInt(config.webJob.firehose.parallelism) : 50;
  const emptyQueueDelaySeconds = config.webJob.firehose.emptyQueueDelaySeconds ? parseInt(config.webJob.firehose.emptyQueueDelaySeconds) : 10;

  console.log(`Job started ${startedString} and will run for ${runtimeSeconds}s with empty delays of ${emptyQueueDelaySeconds}s`);

  const app = require('../../app');
  config.skipModules = new Set([
    'web',
  ]);

  app.initializeJob(config, null, (error) => {
    if (error) {
      throw error;
    }
    const insights = app.settings.appInsightsClient;
    if (!insights) {
      throw new Error('No app insights client available');
    }
    const firehoseConfig = config.webJob.firehose;
    if (!firehoseConfig) {
      throw new Error('No firehose configuration');
    }
    const serviceBusConfig = firehoseConfig.serviceBus;
    if (!serviceBusConfig || !serviceBusConfig.connectionString || !serviceBusConfig.topic || !serviceBusConfig.subscriptionName) {
      throw new Error('No service bus configuration for the firehose webjob');
    }
    const serviceBusService = serviceBus.createServiceBusService(serviceBusConfig.connectionString);
    serviceBusService.getSubscription(serviceBusConfig.topic, serviceBusConfig.subscriptionName, (getSubscriptionError, subscription) => {
      if (getSubscriptionError && getSubscriptionError.statusCode === 404) {
        console.log(`Creating Service Bus subscription ${serviceBusConfig.subscriptionName} in topic ${serviceBusConfig.topic}`);
        const subscriptionOptions = {
          LockDuration: 'PT30S',
          DefaultMessageTimeToLive: 'P7D',
        };
        return serviceBusService.createSubscription(serviceBusConfig.topic, serviceBusConfig.subscriptionName, subscriptionOptions, (createSubscriptionError) => {
          insights.trackEvent({
            name: 'JobFirehoseCreatingSubscription',
            properties: {
              hostname: os.hostname(),
              topic: serviceBusConfig.topic,
              subscription: serviceBusConfig.subscriptionName,
            },
          });
          if (createSubscriptionError) {
            throw createSubscriptionError;
          }
          return subscriptionReady(app, serviceBusService, serviceBusConfig, firehoseConfig, 2, 0);
        });
      } else if (getSubscriptionError) {
        throw getSubscriptionError;
      }
      let deadLetters = 0;
      let messageCount = 0;
      if (subscription && subscription.MessageCount) {
        messageCount = parseInt(subscription.MessageCount, 10);
        let activeMessageCountValue = subscription.CountDetails['d3p1:ActiveMessageCount'];
        if (activeMessageCountValue) {
          messageCount = parseInt(activeMessageCountValue, 10);
        }
        let deadLetterCountValue = subscription.CountDetails['d3p1:DeadLetterMessageCount'];
        if (deadLetterCountValue) {
          deadLetters = parseInt(deadLetterCountValue, 10);
        }
      }
      console.log(`Subscription ${subscription.SubscriptionName} is active and currently has ${messageCount} messages in the queue and ${deadLetters} dead letters`);
      return subscriptionReady(app, serviceBusService, serviceBusConfig, firehoseConfig, messageCount, deadLetters);
    });
  });

  function subscriptionReady(app, serviceBusService, serviceBusConfig, firehoseConfig, messagesInQueue, deadLetters) {
    let parallelism = messagesInQueue > maxParallelism / 2 ? maxParallelism : Math.min(5, maxParallelism);
    console.log(`Parallelism for this run will be ${parallelism} logical threads`);
    const insights = app.settings.appInsightsClient;
    insights.trackEvent({
      name: 'JobFirehoseStarted',
      properties: {
        hostname: os.hostname(),
        topic: serviceBusConfig.topic,
        subscription: serviceBusConfig.subscriptionName,
        messagesInQueue: messagesInQueue.toString(),
        deadLetters: deadLetters.toString(),
      },
    });
    insights.trackMetric({ name: 'FirehoseMessagesInQueue', value: messagesInQueue });
    insights.trackMetric({ name: 'FirehoseDeadLetters', value: deadLetters });
    const tasks = [];
    for (let i = 0; i < parallelism; i++) {
      tasks.push(foreverExecutionThread.bind(null, app, serviceBusService, serviceBusConfig, firehoseConfig));
    }
    async.parallelLimit(tasks, parallelism);
  }

  function foreverExecutionThread(app, serviceBusService, serviceBusConfig, firehoseConfig) {
    async.forever(performIteration.bind(null, app, serviceBusService, serviceBusConfig, firehoseConfig), error => {
      if (error) {
        const insights = app.settings.appInsightsClient;
        insights.trackEception({ exception: error });
        insights.trackEvent({
          name:'JobFirehoseFatalError',
          properties: {
            message: error.message,
          },
        });
      }
    });
  }

  function performIteration(app, serviceBusService, serviceBusConfig, firehoseConfig, callback) {
    serviceBusService.receiveSubscriptionMessage(serviceBusConfig.topic, serviceBusConfig.subscriptionName, {
      isPeekLock: true,
    }, (peekError, lockedMessage) => {
      if (!lockedMessage) {
        console.log(`[empty queue] ${emptyQueueDelaySeconds}s until retry`);
        return setTimeout(callback, emptyQueueDelaySeconds * 1000);
      }
      console.log(`[message ${lockedMessage.brokerProperties.MessageId}] dequeued`);
      const insights = app.settings.appInsightsClient;

      let object = null;
      let properties = lockedMessage.customProperties;
      const rawBody = lockedMessage.body;
      try {
        object = JSON.parse(lockedMessage.body);
      } catch (notJson) {
        console.log('could not parse a message. not deleting the message.');
        return callback();
      }

      const logicAppStarted = moment.utc(properties.started);
      if (logicAppStarted) {
        // const enqueued = lockedMessage && lockedMessage.brokerProperties ? lockedMessage.brokerProperties.EnqueuedTimeUtc : null;
        // const serviceBusDelay = moment.utc(enqueued, 'ddd, DD MMM YYYY HH:mm:ss'); // console.log('delays - bus delay: ' + serviceBusDelay.fromNow() + ', logic app to now: ' + logicAppStarted.fromNow() + ', total ms: ' + totalMs.toString());
        const totalSeconds = moment.utc().diff(logicAppStarted) / 1000;
        insights.trackMetric({ name: 'JobFirehoseQueueDelay', value: totalSeconds });
      }
      const acknowledgeEvent = function () {
        console.log(`[message ${lockedMessage.brokerProperties.MessageId}] acknowledged (deleted)`);
        serviceBusService.deleteMessage(lockedMessage, (deleteError) => {
          if (deleteError) {
            console.dir(deleteError);
          } else {
            ++processedEvents;
          }
        });
      };
      let organization = null;
      const orgName = object.organization ? object.organization.login : null;
      if (!orgName) {
        acknowledgeEvent();
        return callback(new Error('No organization.login present in the event body'));
      }
      const operations = app.settings.operations as Operations;
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
              orgName: orgName,
            },
          });
        } else {
          insights.trackException({ exception: noOrganizationError });
          insights.trackEvent({
            name: 'JobFirehoseMissingOrganizationConfiguration',
            properties: {
              orgName: orgName,
            },
          });
        }
        return callback();
      }
      let data = {
        properties: properties,
        rawBody: rawBody,
        body: object,
      };
      const options = {
        operations: app.settings.operations,
        organization: organization,
        event: data,
        acknowledgeValidEvent: acknowledgeEvent,
      };
      organizationWebhookProcessor(options, (processingError, interestingEvents) => {
        if (processingError) {
          console.warn('Service bus event error during task phase');
          console.warn(processingError);
        }
        const eventType = data.properties.event;
        if (interestingEvents && eventType) {
          processedEventTypes[eventType] += interestingEvents;
        }
        return callback();
      });
    });
  }
};
