//
// Copyright (c) Microsoft. All rights reserved.
//

// microsoftMailAddressProvider.js: THIS FILE IS FOR INTERNAL USE AND SHOULD NOT BE OPEN SOURCED AT THIS TIME

'use strict';

const async = require('async');

module.exports = function createMailAddressProvider(options) {
  const redisClient = options.redisClient;
  if (!redisClient) {
    throw new Error('This provide requires a redisClient instance.');
  }

  function getLegalContactInformationFromUpn(upn, callback) {
    getEntryFromUpn(upn, (entryError, entry) => {
      if (entryError) {
        return callback(entryError);
      }
      async.whilst(
        () => {
          return entry && !entry.legal;
        },
        next => {
          if (!entry) {
            return next(new Error('No entry was found while looking up legal contact information'));
          }
          if (!entry.userPrincipalName) {
            return next(new Error('While looking up entries for legal contacts, a user without a UPN was encountered'));
          }
          getManagerInformationFromUpn(entry.userPrincipalName, (managerError, manager) => {
            if (managerError) {
              return next(managerError);
            }
            if (!manager) {
              throw new Error('');
            }
            entry = manager;
            return next();
          });
        },
        error => {
          if (!error && (!entry || !entry.legal)) {
            error = new Error('Could not retrieve the legal contact');
          }
          if (error) {
            return callback(error);
          }
          let legalInfo = {
            assignedTo: entry,
            legalContact: null,
          };
          getEntryFromUpn(entry.legal, (legalError, legal) => {
            if (legalError) {
              return callback(legalError);
            }
            legalInfo.legalContact = legal;
            return callback(null, legalInfo);
          });
        });
    });
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
    getManagerInformationFromUpn: getManagerInformationFromUpn,
    getLegalContactInformationFromUpn: getLegalContactInformationFromUpn,
    getCorporateEntry: getCorporateEntry,
  };
};
