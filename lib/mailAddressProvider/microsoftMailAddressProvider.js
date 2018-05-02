//
// Copyright (c) Microsoft. All rights reserved.
//

// microsoftMailAddressProvider.js: THIS FILE IS FOR INTERNAL USE AND SHOULD NOT BE OPEN SOURCED AT THIS TIME

'use strict';

const request = require('request');

module.exports = function createMailAddressProvider(options) {
  const config = options.config;
  if (!config.witness || !config.witness.approval || !config.witness.approval.serviceUrl) {
    throw new Error('Not configured for the Witness service');
  }

  const providers = options.providers;
  if (!providers) {
    throw new Error('The microsoftMailAddressProvider requires that all provider instances are passed in as options');
  }

  function getRedisClient() {
    return providers.witnessRedis || providers.redis;
  }

  function getLegalContactInformationFromUpn(upn, callback) {
    const options = getWitnessRequestOptions(config, `/org/user/${upn}`);
    request.get(options, (error, response, entry) => {
      if (!error && (!entry || !entry.legal)) {
        error = new Error('Could not retrieve the legal contact');
      }
      if (error) {
        return callback(error);
      }
      const legalInfo = {
        assignedTo: entry,
        legalContact: entry.legal,
      };
      return callback(null, legalInfo);
    });
  }

  function getWitnessRequestOptions(config, endpoint) {
    const url = config.witness.approval.serviceUrl + endpoint;
    const authToken = 'Basic ' + new Buffer(config.witness.approval.authToken + ':', 'utf8').toString('base64');
    const headers = {
      Authorization: authToken
    };
    return { url: url, headers: headers, json: true };
  }

  function getEntryFromUpn(upn, callback) {
    getCorporateEntry('upns', upn, (redisGetError, entry) => {
      if (redisGetError) {
        return callback(redisGetError);
      }
      return callback(null, entry);
    });
  }

  function getEntryFromAlias(alias, callback) {
    getCorporateEntry('aliases', alias, (redisGetError, entry) => {
      if (redisGetError) {
        return callback(redisGetError);
      }
      return callback(null, entry);
    });
  }

  function getManagerInformationFromUpn(upn, callback) {
    getEntryFromUpn(upn, (error, person) => {
      if (!error && !person) {
        error = new Error(`No entry was retrieved for the UPN ${upn}`);
      }
      if (!error && !person.manager) {
        error = new Error(`No manager is known for UPN ${upn}`);
      }
      if (error) {
        return callback(error);
      }
      getEntryFromAlias(person.manager, (managerError, manager) => {
        return callback(managerError ? managerError : null, managerError ? null : manager);
      });
    });
  }

  function getCorporateEntry(hashKey, hashField, expectJson, callback) {
    if (!callback && typeof(expectJson) === 'function') {
      callback = expectJson;
      expectJson = true;
    }
    const redisClient = getRedisClient();
    redisClient.hget(hashKey, hashField, (redisGetError, data) => {
      if (redisGetError) {
        return callback(redisGetError);
      }
      if (!expectJson) {
        return callback(null, data);
      }
      let person = null;
      if (data) {
        try {
          person = JSON.parse(data);
        } catch (jsonError) {
          return callback(jsonError);
        }
      }
      callback(null, person);
    });
  }

  return {
    getAddressFromUpn: (upn, callback) => {
      getEntryFromUpn(upn, (error, person) => {
        if (error) {
          return callback(error);
        }
        if (person && person.emailAddress) {
          return callback(null, person.emailAddress);
        }
        // We fall back down to the UPN to at a bare minimum have
        // the original logic in play.
        return callback(null, upn);
      });
    },
    getIdFromUpn: (upn, callback) => {
      getEntryFromUpn(upn, (error, person) => {
        if (error) {
          return callback(error);
        }
        if (person && person.aadId) {
          return callback(null, person.aadId);
        }
        return callback(new Error('No ID for the user'));
      });
    },
    getManagerInformationFromUpn: getManagerInformationFromUpn,
    getLegalContactInformationFromUpn: getLegalContactInformationFromUpn,
    getCorporateEntry: getCorporateEntry,
  };
};
