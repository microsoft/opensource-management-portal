//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "log", "dir"] }] */

'use strict';

const _= require('lodash');
const async = require('async');
const crypto = require('crypto');
const secureCompare = require('secure-compare');

const tasks = require('./tasks/');

module.exports = function (options, callback) {
  const operations = options.operations;
  if (!operations) {
    return callback(new Error('No operations instance provided'));
  }
  const organization = options.organization;
  const event = options.event;
  if (!organization || !organization.name) {
    return callback(new Error('Missing organization instance'));
  }
  if (!event) {
    return callback(new Error('Missing event'));
  }
  if (!event.body) {
    return callback(new Error('Missing event body'));
  }
  const body = event.body;
  const rawBody = event.rawBody || JSON.stringify(body);
  const properties = event.properties;
  if (!properties || !properties.delivery || !properties.signature || !properties.event) {
    return callback(new Error('Missing event properties - delivery, signature, and/or event'));
  }
  verifySignatures(properties.signature, organization.webhookSharedSecrets, rawBody, (validationError) => {
    if (validationError) {
      if (operations && operations.insights) {
        const possibleOrganization = body && body.organization ? body.organization.login : 'unknown-org';
        console.warn(`incorrect hook signature - ${possibleOrganization} organization`);
        operations.insights.trackMetric('WebhookIncorrectSecrets', 1);
        operations.insights.trackEvent('WebhookIncorrectSecret', {
          org: possibleOrganization,
          delivery: properties.delivery,
          event: properties.event,
          signature: properties.signature,
          approximateTime: properties.started.toISOString(),
          computedHash: validationError.computedHash,
        });
      }
      return callback(validationError);
    }
    // In a bus scenario, if a short timeout window is used for queue
    // visibility, a client may want to acknowledge this being a valid
    // event at this time. After this point however there is no
    // guarantee of successful execution.
    if (options.acknowledgeValidEvent) {
      options.acknowledgeValidEvent();
    }
    let interestingEvents = 0;
    const work = _.filter(tasks, (processor) => {
      return processor.filter(event);
    });
    if (work.length > 0) {
      ++interestingEvents;
      console.log(`[* interesting event found: ${event.properties.event} (${work.length} interested tasks)]`);
    } else {
      console.log(`[skipping event: ${event.properties.event}]`);
    }
    async.eachSeries(work, (processor, next) => {
      try {
        processor.run(operations, organization, event, next);
      } catch (processInitializationError) {
        console.log('Processor ran into an error with an event:');
        console.dir(processInitializationError);
        return next(processInitializationError);
      }
    }, (error) => {
      return callback(error, interestingEvents);
    });
  });
};

function verifySignatures(signature, hookSecrets, rawBody, callback) {
  // To ease local development and simple scenarios, if no shared secrets are
  // configured, they are not required.
  if (!hookSecrets || !hookSecrets.length) {
    return callback();
  }
  if (!signature) {
    return callback(new Error('No event signature was provided'));
  }
  const computedSignatures = [];
  for (let i = 0; i < hookSecrets.length; i++) {
    const sharedSecret = hookSecrets[i];
    const sha1 = crypto.createHmac('sha1', sharedSecret);
    sha1.update(rawBody, 'utf8');
    const computedHash = 'sha1=' + sha1.digest('hex');
    if (secureCompare(computedHash, signature)) {
      return callback();
    }
    computedSignatures.push(computedHash);
  }
  const validationError = new Error('The signature could not be verified');
  validationError.statusCode = 401;
  validationError.computedHash = computedSignatures.join(', ');
  return callback(validationError);
}
