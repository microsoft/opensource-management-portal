//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// This file is very sad. :(

// This is the original data interface for this portal. It uses Azure
// table storage and its Node.js SDK. There's a lot of potential work
// to do here to better factor this and allow for other data providers
// such as MonogDB...

const azure = require('azure-storage');
const async = require('async');
const uuid = require('node-uuid');
const os = require('os');

var staticHostname = os.hostname().toString();

function DataClient(config, callback) {
  var storageAccountName = config.azureStorage.account;
  var storageAccountKey = config.azureStorage.key;
  var prefix = config.azureStorage.prefix;
  try {
    if (!storageAccountName || !storageAccountKey) {
      throw new Error('Storage account information is not configured.');
    }
    this.table = azure.createTableService(storageAccountName, storageAccountKey);
  } catch (storageAccountError) {
    return callback(storageAccountError);
  }
  this.entGen = azure.TableUtilities.entityGenerator;
  this.options = {
    partitionKey: prefix + 'pk',
    linksTableName: prefix + 'links',
    pendingApprovalsTableName: prefix + 'pending',
    errorsTableName: prefix + 'errors',
  };
  var dc = this;
  var tableNames = [
    dc.options.linksTableName,
    dc.options.pendingApprovalsTableName,
    dc.options.errorsTableName,
  ];
  async.each(tableNames, function (tableName, callback) {
    dc.table.createTableIfNotExists(tableName, callback);
  }, function (error) {
    if (callback) return callback(error, dc);
  });
}

// Strip the Azure table storage fields if no uninteresting fields are provided.
var reduceEntity = function reduceEntity(instance, uninterestingFields) {
  if (instance === undefined || instance === null) {
    return instance;
  }
  if (uninterestingFields === undefined) {
    uninterestingFields = ['.metadata', 'Timestamp', 'RowKey', 'PartitionKey'];
  }
  if (uninterestingFields && uninterestingFields.length) {
    for (var i = 0; i < uninterestingFields.length; i++) {
      if (instance[uninterestingFields[i]] !== undefined) {
        delete instance[uninterestingFields[i]];
      }
    }
  }
  for (var column in instance) {
    if (instance[column] && instance[column]._ !== undefined) {
      instance[column] = instance[column]._;
    }
  }
  return instance;
};

DataClient.prototype.reduceEntity = reduceEntity;

DataClient.prototype.requestToUserInformation = function rtui(req, storeFullUserInformation) {
  var info = {
    ghid: undefined,
    ghu: undefined,
    aad: undefined,
    fulluser: undefined
  };
  if (storeFullUserInformation) {
    info.fulluser = JSON.stringify(req.user);
  }
  if (req && req.user && req.user.github && req.user.github.id) {
    info.ghid = req.user.github.id;
    if (info.ghid.toString) {
      info.ghid = info.ghid.toString();
    }
    if (req.user.github.username) {
      info.ghu = req.user.github.username;
    }
  }
  if (req && req.user && req.user.azure && req.user.azure.username) {
    info.aad = req.user.azure.username;
  }
  return info;
};

DataClient.prototype.insertErrorLogEntry = function insertErrorEntry(version, req, err, meta, callback) {
  // generic configuration, should move out at some point...
  var storeFullUserInformation = false;
  var storeUnknownUserErrors = false;
  var storeRequestInformation = true;
  var cbNoErrors = function (callback) {
    if (callback) {
      callback();
    }
  };
  var dc = this;
  var entity;
  // (PartitionKey, RowKey): (ghid || 0, new uuid)
  // (ghu, ghid, aad): user information
  // (t, cid): (time when method called, correlation ID)
  // (e, json, meta): (error message, JSON serialized err, JSON metadata)
  // (url, host, ...): various host and request informational fields
  try {
    var info = dc.requestToUserInformation(req, storeFullUserInformation);
    // We may encounter users without a session. In these cases, we could log with -1 ID for pkey (OR use correlation ID for the pkey... hmm.)
    if (info.ghid === undefined) {
      if (!storeUnknownUserErrors) {
        return cbNoErrors(callback);
      }
      info.ghid = -1;
    }
    info.v = version;
    if (req.headers && req.headers.referer) {
      info.referer = req.headers.referer;
    }
    var partitionKey = info.ghid;
    var uniqueErrorId = uuid.v4();
    entity = dc.createEntity(partitionKey, uniqueErrorId, info);
    var errorMessage = 'The error object was undefined.';
    var errorJson;
    var errorStack;
    var errorStatus = '200';
    if (err) {
      // If err.meta is set, use that for the metadata up-level, and remove from err object.
      if (err.meta && !meta) {
        meta = err.meta;
        delete err.meta;
      }
      errorStack = err.stack;
      if (err.status) {
        errorStatus = err.status;
        // delete err.status; // ? may not want to do this...
      }
      if (err.message) {
        errorMessage = err.message;
      } else {
        if (err.toString) {
          errorMessage = err.toString();
        } else {
          errorMessage = 'The provided error instance is not a string and has no toString method.';
        }
      }
      try {
        errorJson = JSON.stringify(err);
      } catch (je) {
        // Ignore any serialization errors or circular reference problems, the rest will still be logged in this case.
      }
    }
    var metaJson;
    if (meta) {
      try {
        metaJson = JSON.stringify(meta);
      } catch (je) {
        // Ignore.
      }
    }
    var errorEntity = {
      t: new Date().getTime(),
      cid: (req && req.correlationId ? req.correlationId : undefined),
      e: errorMessage,
      stack: errorStack,
      json: errorJson,
      meta: metaJson,
      status: errorStatus,
      'new': true
    };
    dc.mergeIntoEntity(entity, errorEntity);
    if (storeRequestInformation) {
      var sri = {
        url: req.scrubbedUrl || req.originalUrl || req.url,
        ua: req.headers['user-agent'],
        host: staticHostname
      };
      dc.mergeIntoEntity(entity, sri);
    }
  } catch (ex) {
    // Retry policy could be nice, OR log this separately if possible.
    return cbNoErrors(callback);
  }
  if (entity) {
    dc.table.insertEntity(dc.options.errorsTableName, entity, function (/* ignoredError */) {
      cbNoErrors(callback);
    });
  } else {
    cbNoErrors(callback);
  }
};

DataClient.prototype.updateError = function (partitionKey, rowKey, mergeEntity, callback) {
  var dc = this;
  var entity = dc.createEntity(partitionKey, rowKey, mergeEntity);
  dc.table.mergeEntity(dc.options.errorsTableName, entity, callback);
};

DataClient.prototype.removeError = function (partitionKey, rowKey, callback) {
  var dc = this;
  dc.table.deleteEntity(dc.options.errorsTableName, dc.createEntity(partitionKey, rowKey), callback);
};

DataClient.prototype.getActiveErrors = function (correlationId, callback) {
  var dc = this;
  // Correlation ID is optional
  if (typeof (correlationId) === 'function') {
    callback = correlationId;
    correlationId = undefined;
  }
  var metadataFieldsToSkip = ['.metadata', 'Timestamp'];
  var done = false;
  var continuationToken = null;
  var entries = [];
  async.whilst(
    function () { return !done; },
    function (asyncCallback) {
      var query = new azure.TableQuery()
        .where('new eq ?', true);
      if (correlationId) {
        query.and.apply(query, ['cid eq ?', correlationId]);
      }
      dc.table.queryEntities(dc.options.errorsTableName, query, continuationToken, function (error, results) {
        if (error) {
          done = true;
          return asyncCallback(error);
        }
        if (results.continuationToken) {
          continuationToken = results.continuationToken;
        } else {
          done = true;
        }
        if (results && results.entries && results.entries.length) {
          for (var i = 0; i < results.entries.length; i++) {
            entries.push(reduceEntity(results.entries[i], metadataFieldsToSkip));
          }
        }
        asyncCallback();
      });
    }, function (error) {
      if (error) {
        return callback(error);
      }
      async.sortBy(entries, function (entity, scb) {
        var t;
        var err = null;
        try {
          t = Math.round(entity.t) * -1;
        }
        catch (trx) {
          err = trx;
        }
        return scb(err, t);
      }, callback);
    });
};

DataClient.prototype.mergeIntoEntity = function mit(entity, obj, callback) {
  var dc = this;
  if (obj) {
    for (var key in obj) {
      if (obj[key] === undefined) {
        // Skip undefined objects, including the key
      } else if (obj[key] === true) {
        entity[key] = dc.entGen.Boolean(true);
      } else if (obj[key] === false) {
        entity[key] = dc.entGen.Boolean(false);
      } else {
        // CONSIDER: Richer merging opportunities!
        if (obj[key].toString) {
          entity[key] = dc.entGen.String(obj[key].toString());
        } else {
          entity[key] = dc.entGen.String(obj[key]);
        }
      }
    }
  }
  if (callback) {
    callback(null, entity);
  } else {
    return entity;
  }
};

DataClient.prototype.createEntity = function ce(partitionKey, rowKey, obj, callback) {
  var dc = this;
  if (typeof (obj) === 'function') {
    callback = obj;
    obj = undefined;
  }
  var entity = {
    PartitionKey: dc.entGen.String(partitionKey),
    RowKey: dc.entGen.String(rowKey)
  };
  if (obj) {
    dc.mergeIntoEntity(entity, obj);
  }
  if (callback) {
    callback(null, entity);
  } else {
    return entity;
  }
};

// links
// -----
// CONSIDER: Replace link calls with reduced entity "association" calls, then depre. & remove these funcs.
DataClient.prototype.createLinkObjectFromRequest = function createLinkObject(req, callback) {
  if (req && req.user && req.user.github && req.user.azure && req.user.github.username && req.user.github.id && req.user.azure.username && req.user.azure.oid) {
    var link = {
      ghu: req.user.github.username,
      ghid: req.user.github.id.toString(),
      aadupn: req.user.azure.username,
      aadname: req.user.azure.displayName,
      aadoid: req.user.azure.oid,
      joined: new Date().getTime(),
    };
    link.ghavatar = req.user.github.avatarUrl;
    if (req.user.github.accessToken) {
      link.ghtoken = req.user.github.accessToken;
      link.ghtokenupdated = new Date().getTime();
    }
    return callback(null, link);
  } else {
    return callback(new Error('Not all fields needed for creating a link are available and authenticated. This may be a temporary problem or an implementation bug.'));
  }
};

DataClient.prototype.getUserLinks = function gul(users, callback) {
  var dc = this;
  var query = new azure.TableQuery()
    .where('PartitionKey eq ?', this.options.partitionKey);
  if (!(users && users.length && users.length > 0)) {
    return callback(new Error('Must include an array of GitHub user IDs, and at least one in that array.'));
  }
  var clauses = [];
  if (users.length > 250) {
    // TODO: Write better code here to use continuation tokens and utilities to resolve any number from storage.
    return callback(new Error(`The application has queried for ${users.length} entities, which is too many for the current design.`));
  }
  for (var i = 0; i < users.length; i++) {
    clauses.push('ghid eq ?string?');
  }
  var args = [clauses.join(' or ')].concat(users);
  query.and.apply(query, args);
  dc.table.queryEntities(dc.options.linksTableName,
    query,
    null,
    function (error, results, headers) {
      if (error) {
        error.headers = headers;
        return callback(error);
      }
      var entries = [];
      if (results && results.entries && results.entries.length) {
        for (var i = 0; i < results.entries.length; i++) {
          entries.push(reduceEntity(results.entries[i]));
        }
      }
      async.sortBy(entries, function (user, sortCallback) {
        var value = user.aadupn || user.aadname || user.ghu || user.ghid;
        if (value.toLowerCase) {
          value = value.toLowerCase();
        }
        sortCallback(null, value);
      }, callback);
    });
};

DataClient.prototype.getUserLinkByUsername = function gulbyu(githubUsername, callback) {
  this.getUserLinkByProperty('ghu', githubUsername, function (error, data) {
    if (error) return callback(error);
    if (data && data.length) {
      if (data.length === 1) {
        callback(null, data[0]);
      } else {
        if (data.length === 0) {
          callback(null, false);
        } else {
          callback(new Error('Multiple entries returned. The data may be consistent. Please file a bug.'));
        }
      }
    } else {
      callback(new Error('No results.'));
    }
  });
};

DataClient.prototype.updateLink = function updl(userid, mergeEntity, callback) {
  var dc = this;
  var entity = dc.createEntity(dc.options.partitionKey, userid, mergeEntity);
  dc.table.mergeEntity(dc.options.linksTableName, entity, callback);
};

DataClient.prototype.getUserByAadUpn = function gubauapn(employeeAlias, callback) {
  this.getUserLinkByProperty('aadupn', employeeAlias.toLowerCase(), callback);
};

DataClient.prototype.getUserByAadOid = function getByOid(oid, callback) {
  this.getUserLinkByProperty('aadoid', oid, callback);
};

DataClient.prototype.getUserLinkByProperty = function gulbprop(propertyName, value, callback) {
  var dc = this;
  var query = new azure.TableQuery()
    .where(propertyName + ' eq ?', value);
  dc.table.queryEntities(dc.options.linksTableName,
    query,
    null,
    function (error, results) {
      if (error) return callback(error);
      var entries = [];
      if (results && results.entries && results.entries.length) {
        for (var i = 0; i < results.entries.length; i++) {
          entries.push(reduceEntity(results.entries[i]));
        }
      }
      callback(null, entries);
    });
};

DataClient.prototype.getLink = function getLink(githubId, callback) {
  var dc = this;
  if (githubId === undefined) {
    return callback(new Error('The GitHub ID is undefined.'));
  }
  if (typeof githubId != 'string') {
    githubId = githubId.toString();
  }
  dc.table.retrieveEntity(dc.options.linksTableName, dc.options.partitionKey, githubId, function (error, result, response) {
    if (error && !result) {
      return callback(null, false);
    }
    return callback(error, result, response);
  });
};

DataClient.prototype.getAllEmployees = function getAllEmployees(callback) {
  var dc = this;
  var pageSize = 500;
  var employees = [];
  var done = false;
  var continuationToken = null;
  async.whilst(
    function areWeDone() { return !done; },
    function grabPage(cb) {
      var query = new azure.TableQuery()
        .select(['aadupn', 'ghu', 'ghid'])
        .top(pageSize);
      dc.table.queryEntities(dc.options.linksTableName, query, continuationToken, function (error, results) {
        if (error) {
          done = true;
          return cb(error);
        }
        if (results.continuationToken) {
          continuationToken = results.continuationToken;
        } else {
          done = true;
        }
        if (results && results.entries && results.entries.length) {
          for (var i = 0; i < results.entries.length; i++) {
            employees.push(reduceEntity(results.entries[i]));
          }
        }
        cb();
      });
    }, function (error) {
      if (error) return callback(error);
      async.sortBy(employees, function (person, sortCallback) {
        if (person.aadupn && person.aadupn.toLowerCase) {
          person.aadupn = person.aadupn.toLowerCase();
        }
        sortCallback(null, person.aadupn);
      }, callback);
    });
};

// 9/4/15 jwilcox: insertLink and updateLink now use the shared merge/copy entity calls. Previously these 2 methods instead did a string-only entGen and copy of key/values, so beware any behavior changes. Remove this line once happy with that.
DataClient.prototype.insertLink = function insertLink(githubId, details, callback) {
  var dc = this;
  if (githubId === undefined) {
    return callback(new Error('The GitHub ID is undefined.'));
  }
  if (typeof githubId != 'string') {
    githubId = githubId.toString();
  }
  var entity = dc.createEntity(dc.options.partitionKey, githubId, details);
  dc.table.insertEntity(dc.options.linksTableName, entity, callback);
};

DataClient.prototype.updateLink = function insertLink(githubId, details, callback) {
  var dc = this;
  if (githubId === undefined) {
    return callback(new Error('The GitHub ID is undefined.'));
  }
  if (typeof githubId != 'string') {
    githubId = githubId.toString();
  }
  var entity = dc.createEntity(dc.options.partitionKey, githubId, details);
  dc.table.mergeEntity(dc.options.linksTableName, entity, callback);
};

DataClient.prototype.removeLink = function removeLink(githubId, callback) {
  var dc = this;
  if (githubId === undefined) {
    return callback(new Error('The GitHub ID is undefined.'));
  }
  if (typeof githubId != 'string') {
    githubId = githubId.toString();
  }
  dc.table.deleteEntity(dc.options.linksTableName, dc.createEntity(dc.options.partitionKey, githubId), callback);
};

// pending approvals workflow
// --------------------------
DataClient.prototype.getPendingApprovals = function getPendingApprovals(teamsIn, callback) {
  var dc = this;
  var teams = null;
  var i;
  if (typeof teamsIn === 'number') {
    teams = [teamsIn.toString()];
  }
  else if (typeof teamsIn === 'string') {
    teams = [teamsIn];
  } else if (typeof teamsIn === 'function') {
    callback = teamsIn;
    teams = []; // Special case: empty list means all pending approvals
  } else {
    if (!(teamsIn && teamsIn.length)) {
      throw new Error('Unknown "teams" type for getPendingApprovals. Please file a bug.');
    }
    // New permissions system refactoring...
    if (teamsIn.length > 0 && teamsIn[0] && teamsIn[0].id) {
      teams = [];
      for (i = 0; i < teamsIn.length; i++) {
        teams.push(teamsIn[i].id);
      }
    }
  }
  var query = new azure.TableQuery()
    .where('PartitionKey eq ?', this.options.partitionKey)
    .and('active eq ?', true);
  if (teams.length > 0) {
    var clauses = [];
    for (i = 0; i < teams.length; i++) {
      clauses.push('teamid eq ?string?');
    }
    var args = [clauses.join(' or ')].concat(teams);
    query.and.apply(query, args);
  }
  dc.table.queryEntities(dc.options.pendingApprovalsTableName,
    query,
    null,
    function (error, results) {
      if (error) return callback(error);
      var entries = [];
      if (results && results.entries && results.entries.length) {
        for (var i = 0; i < results.entries.length; i++) {
          var r = results.entries[i];
          if (r && r.active && r.active._) {
            entries.push(reduceEntity(r, ['.metadata']));
          }
        }
      }
      callback(null, entries);
    });
};

DataClient.prototype.insertApprovalRequest = function iar(teamid, details, callback) {
  var dc = this;
  if (typeof teamid != 'string') {
    teamid = teamid.toString();
  }
  details.teamid = teamid;
  dc.insertGeneralApprovalRequest('joinTeam', details, callback);
};

DataClient.prototype.insertGeneralApprovalRequest = function igar(ticketType, details, callback) {
  var dc = this;
  var id = uuid.v4();
  var entity = dc.createEntity(dc.options.partitionKey, id, {
    tickettype: ticketType
  });
  dc.mergeIntoEntity(entity, details);
  dc.table.insertEntity(dc.options.pendingApprovalsTableName, entity, function (error, result, response) {
    if (error) {
      return callback(error);
    }
    // Pass back the generated request ID first.
    callback(null, id, result, response);
  });
};

DataClient.prototype.getApprovalRequest = function gar(requestId, callback) {
  var dc = this;
  dc.table.retrieveEntity(dc.options.pendingApprovalsTableName, dc.options.partitionKey, requestId, function (error, ent) {
    if (error) return callback(error);
    callback(null, reduceEntity(ent, ['.metadata']));
  });
};

DataClient.prototype.getPendingApprovalsForUserId = function gpeaf(githubid, callback) {
  var dc = this;
  if (typeof githubid === 'number') {
    githubid = githubid.toString();
  }
  var query = new azure.TableQuery()
    .where('PartitionKey eq ?', this.options.partitionKey)
    .and('active eq ?', true)
    .and('ghid eq ?', githubid);
  dc.table.queryEntities(dc.options.pendingApprovalsTableName,
    query,
    null,
    function (error, results) {
      if (error) return callback(error);
      var entries = [];
      if (results && results.entries && results.entries.length) {
        for (var i = 0; i < results.entries.length; i++) {
          var r = results.entries[i];
          if (r && r.active && r.active._) {
            entries.push(reduceEntity(r, ['.metadata']));
          }
        }
      }
      callback(null, entries);
    });
};

DataClient.prototype.updateApprovalRequest = function uar(requestId, mergeEntity, callback) {
  var dc = this;
  var entity = dc.createEntity(dc.options.partitionKey, requestId, mergeEntity);
  dc.table.mergeEntity(dc.options.pendingApprovalsTableName, entity, callback);
};

module.exports = DataClient;
