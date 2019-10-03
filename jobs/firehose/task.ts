//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

'use strict';

// Firehose processing specific to repos

import async = require('async');
import moment from 'moment';

import { Operations } from '../../business/operations';
import ProcessOrganizationWebhook from '../../webhooks/organizationProcessor';

const os = require('os');
const serviceBus = require('azure-sb');

const isClearingDeadLetterQueue = false;

const runningAsOngoingDeployment = true;

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
  if (runningAsOngoingDeployment) {
    console.log('firehose is configured to keep running, it will not exit');
  } else {
    setTimeout(() => {
      const finishing = moment().utc().format();
      console.log(`Ending run after ${runtimeSeconds}s at ${finishing} after finding ${interestingEvents} events of interest and processing ${processedEvents}`);
      console.dir(processedEventTypes);
      process.exit(0);
    }, runtimeSeconds * 1000);
  }

  const maxParallelism = config.webJob.firehose.parallelism ? parseInt(config.webJob.firehose.parallelism) : 50;
  const emptyQueueDelaySeconds = config.webJob.firehose.emptyQueueDelaySeconds ? parseInt(config.webJob.firehose.emptyQueueDelaySeconds) : 10;

  if (runningAsOngoingDeployment) {
    console.log(`Firehose app started ${startedString} and will run with empty delays of ${emptyQueueDelaySeconds}s`);
  } else {
    console.log(`Job started ${startedString} and will run for ${runtimeSeconds}s with empty delays of ${emptyQueueDelaySeconds}s`);
  }

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
    if (!serviceBusConfig || !serviceBusConfig.connectionString || !serviceBusConfig.queue) {
      throw new Error('No service bus queue configuration for the firehose webjob');
    }
    // NOTE: this architecture moved from topics to queues in 2019. It is still using the very old library.
    const serviceBusService = serviceBus.createServiceBusService(serviceBusConfig.connectionString);
    // let parallelism = messagesInQueue > maxParallelism / 2 ? maxParallelism : Math.min(5, maxParallelism);
    let parallelism = maxParallelism;
    console.log(`Parallelism for this run will be ${parallelism} logical threads`);
    // const insights = app.settings.appInsightsClient;
    insights.trackEvent({
      name: 'JobFirehoseStarted',
      properties: {
        hostname: os.hostname(),
        queue: serviceBusConfig.queue,
        subscription: serviceBusConfig.subscriptionName,
        // messagesInQueue: messagesInQueue.toString(),
        //deadLetters: deadLetters.toString(),
      },
    });
    //insights.trackMetric({ name: 'FirehoseMessagesInQueue', value: messagesInQueue });
    //insights.trackMetric({ name: 'FirehoseDeadLetters', value: deadLetters });
    const tasks = [];
    for (let i = 0; i < parallelism; i++) {
      tasks.push(foreverExecutionThread.bind(null, app, serviceBusService, serviceBusConfig, firehoseConfig));
    }
    async.parallelLimit(tasks, parallelism);
  });

  function foreverExecutionThread(app, serviceBusService, serviceBusConfig, firehoseConfig) {
    async.forever(performIteration.bind(null, app, serviceBusService, serviceBusConfig, firehoseConfig), error => {
      if (error) {
        const insights = app.settings.appInsightsClient;
        insights.trackException({ exception: error });
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
    //const subscriptionPath = isClearingDeadLetterQueue ? `${serviceBusConfig.subscriptionName}/$deadletterqueue` : serviceBusConfig.subscriptionName;
    //serviceBusService.receiveSubscriptionMessage(serviceBusConfig.topic, subscriptionPath, {
    serviceBusService.receiveQueueMessage(serviceBusConfig.queue, {
      isPeekLock: true,
    }, (peekError, lockedMessage) => {
      if (peekError === 'No messages to receive') {
        console.log(`[empty queue] ${emptyQueueDelaySeconds}s until retry`);
        return setTimeout(callback, emptyQueueDelaySeconds * 1000);
      } else if (peekError) {
        console.dir(peekError);
        return setTimeout(callback, emptyQueueDelaySeconds * 1000);
      }
      if (!lockedMessage) {
        console.log(`[empty queue] ${emptyQueueDelaySeconds}s until retry`);
        return setTimeout(callback, emptyQueueDelaySeconds * 1000);
      }
      const originalEventQueued = moment(lockedMessage.brokerProperties.EnqueuedTimeUtc);
      const deliveryAttempt = lockedMessage.brokerProperties.DeliveryCount == /* loose */ 1 ? '' : ` delivery attempt ${lockedMessage.brokerProperties.DeliveryCount}`;
      const now = moment();
      console.log(`[message ${lockedMessage.brokerProperties.MessageId}] dequeued from ${now.diff(originalEventQueued, 'seconds', true)}s${deliveryAttempt}`);
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
      
      const operations = app.settings.operations as Operations;
      let organization = null;
      const installationBody = object.installation;
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
            return callback();
          }
        } else if (installationBody.target_type) {
          console.log(`invalid target type ${installationBody.target_type} for installation id=${installationBody.id}`)
          acknowledgeEvent();
          return callback();
        }
      }

      if (!orgName && object.organization) {
        orgName = object.organization ? object.organization.login : null;
      }
      if (!orgName) {
        acknowledgeEvent();
        return callback(new Error('No organization.login present in the event body'));
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
      ProcessOrganizationWebhook(options).then(interestingEvents => {
        const eventType = data.properties.event;
        if (interestingEvents && eventType) {
          processedEventTypes[eventType] += interestingEvents;
        }
        return callback();
      }).catch(processingError => {
        if (processingError) {
          console.warn('Service bus event error during task phase');
          console.warn(processingError);
        }
        return callback();
      });
    });
  }
};
