//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const async = require('async');

const utils = require('../utils');

// TODO: Refactor OSS user to better be able to remove the user using the central codepath.

// These functions are not pretty.

router.use(function ensureOrganizationSudoer(req, res, next) {
  req.legacyUserContext.isPortalAdministrator(function (error, isAdmin) {
    if (isAdmin === true) {
      return next();
    }
    next(utils.wrapError(null, 'These aren\'t the droids you are looking for. You do not have permission to be here.', true));
  });
});

router.get('/', function (req, res) {
  req.legacyUserContext.render(req, res, 'organization/index', 'Organization Dashboard');
});

function tryGetGithubUserIdFromUsernameLink(dc, config, oldGithubUsername, callback) {
  dc.getUserLinkByProperty('ghu', oldGithubUsername, (getError, links) => {
    if (!getError && links && links.length === 0) {
      getError = new Error(`No link found by searching for the old username "${oldGithubUsername}".`);
    }
    if (!getError && links && links.length > 1) {
      getError = new Error(`While searching for a link by the old username "${oldGithubUsername}" there were ${links.length} results instead of 1.`);
    }
    if (getError) {
      return callback(getError);
    }
    callback(null, links[0]);
  });
}

function whoisById(dc, config, githubId, userInfo, callback) {
  if (userInfo && userInfo.ghid && userInfo.ghu) {
    // Rename scenario; pass back the link
    return callback(null, userInfo);
  }
  dc.getLink(githubId, function (error, ok) {
    if (ok) {
      ok = dc.reduceEntity(ok);
    } else {
      ok = {
        githubInfoButNoLink: userInfo
      };
    }
    return callback(error, ok);
  });
}

function expandAllInformation(req, dc, config, entity, callback) {
  const operations = req.app.settings.providers.operations;
  const orgsList = operations.organizations;
  const orgsUserIn = [];
  const ghid = entity.ghid || (entity.githubInfoButNoLink ? entity.githubInfoButNoLink.id : undefined);
  const account = operations.getAccount(ghid);
  account.getDetails(getUsernameError => {
    if (getUsernameError) {
      return callback(getUsernameError);
    }
    const username = account.login;
    if (entity && entity.ghu !== undefined && entity.ghu !== username) {
      entity.renamedUserMessage = `This user used to be known as "${entity.ghu}" on GitHub but changed their username to "${username}".`;
      entity.ghu = username;
    }
    async.each(orgsList, function (organization, callback) {
      organization.getMembership(username, function (err, membership) {
        if (membership && membership.state) {
          orgsUserIn.push(organization);
        }
        callback(null, membership);
      });
    }, function (expansionError) {
      entity.orgs = orgsUserIn;
      callback(expansionError, entity);
    });
  });
}

function getPersonServiceEntryByUpn(redisClient, upn, callback) {
  redisClient.hget('upns', upn, (redisGetError, data) => {
    if (redisGetError) {
      return callback(redisGetError);
    }
    var person = null;
    if (data) {
      try {
        person = JSON.parse(data);
      } catch (jsonError) {
        return callback(jsonError);
      }
    }
    if (person) {
      return callback(null, person);
    }
    return callback(null, null);
  });
}

function getRealtimeAadIdInformation(req, anyInfo, callback) {
  if (!anyInfo || !anyInfo.aadoid) {
    return callback();
  }
  const graphProvider = req.app.settings.graphProvider;
  if (!graphProvider) {
    return callback();
  }
  const aadId = anyInfo.aadoid;
  graphProvider.getUserAndManagerById(aadId, callback);
}

router.get('/whois/aad/:upn', function (req, res, next) {
  var config = req.app.settings.runtimeConfig;
  var dc = req.app.settings.dataclient;
  var redisClient = req.app.settings.dataclient.cleanupInTheFuture.redisClient;
  var upn = req.params.upn;
  dc.getUserByAadUpn(upn, function (error, usr) {
    if (error) {
      error.skipLog = true;
      return next(error);
    }
    if (usr.length && usr.length > 0) {
      expandAllInformation(req, dc, config, usr[0], function (error, z) {
        getPersonServiceEntryByUpn(redisClient, upn, (getInformationError, personEntry) => {
          getRealtimeAadIdInformation(req, z, (ignore, realtimeGraph) => {
            req.legacyUserContext.render(req, res, 'organization/whois/result', 'Whois by AAD UPN: ' + upn, {
              personEntry: personEntry,
              upn: upn,
              info: z,
              realtimeGraph: realtimeGraph,
            });
          });
        });
      });
    } else {
      return next(utils.wrapError(null, 'User not found', true));
    }
  });
});

router.get('/bulkRepoDelete', (req, res) => {
  const legacyUserContext = req.legacyUserContext;
  legacyUserContext.render(req, res, 'organization/bulkRepoDelete', 'Bulk repository delete');
});

router.post('/bulkRepoDelete', (req, res, next) => {
  const operations = req.app.settings.operations;
  let repositories = req.body.repositories;
  if (!repositories) {
    return next(new Error('No repositories provided'));
  }
  repositories = repositories.split('\n');
  const log = [];
  async.eachLimit(repositories, 1, (repositoryName, next) => {
    repositoryName = (repositoryName || '').trim();
    if (!repositoryName.length) {
      return next();
    }
    let githubcom = 'github.com';
    let ghi = repositoryName.indexOf(githubcom);
    if (ghi >= 0) {
      let name = repositoryName.substr(ghi + githubcom.length + 1);
      let divider = name.indexOf('/');
      if (divider <= 0) {
        return next();
      }
      let orgName = name.substr(0, divider);
      let repoName = name.substr(divider + 1);
      const repository = operations.getOrganization(orgName).repository(repoName);
      repository.delete((errorIsh, more) => {
        if (errorIsh) {
          log.push(name + ': ' + errorIsh);
        } else {
          let metaStatus = more && more.meta ? more.meta.status : null;
          log.push(name + ': ' + metaStatus);
        }
        return next();
      });
    } else {
      log.push(`Skipping, does not appear to be a GitHub repo URL: ${repositoryName}`);
      return next();
    }
  }, error => {
    if (error) {
      return next(error);
    }
    res.json(log);
  });
});

router.get('/errors/active', function (req, res, next) {
  var dc = req.app.settings.dataclient;
  dc.getActiveErrors(function (error, errors) {
    if (error) {
      return next(error);
    }
    req.legacyUserContext.render(req, res, 'organization/errorsList', 'Untriaged errors', {
      errors: errors,
    });
  });
});

router.post('/errors/:partition/:row', function (req, res, next) {
  var partitionKey = req.params.partition;
  var errorId = req.params.row;
  var action = req.body.action;
  var dc = req.app.settings.dataclient;
  if (action == 'Archive') {
    dc.updateError(partitionKey, errorId, {
      'new': false
    }, function (error) {
      if (error) {
        return next(error);
      }
      req.legacyUserContext.saveUserAlert(req, 'Error ' + partitionKey + '/' + errorId + ' triaged.', 'Marked as no longer a new error instance', 'success');
      res.redirect('/organization/errors/active/');
    });
  } else if (action == 'Delete') {
    dc.removeError(partitionKey, errorId, function (error) {
      if (error) {
        return next(error);
      }
      req.legacyUserContext.saveUserAlert(req, 'Error ' + partitionKey + '/' + errorId + ' deleted.', 'Deleted', 'success');
      res.redirect('/organization/errors/active/');
    });
  } else {
    return next(new Error('Action not supported: ' + action));
  }
});

router.get('/whois/id/:githubid', function (req, res) {
  var config = req.app.settings.runtimeConfig;
  var dc = req.app.settings.dataclient;
  var id = req.params.githubid;
  whoisById(dc, config, id, undefined, function (error, userInfoFinal) {
    expandAllInformation(req, dc, config, userInfoFinal, function(error, z) {
      getRealtimeAadIdInformation(req, z, (ignore, realtimeGraph) => {
        req.legacyUserContext.render(req, res, 'organization/whois/result', 'Whois by GitHub ID: ' + req.params.githubid, {
          info: z,
          postUrl: '/organization/whois/id/' + id,
          realtimeGraph: realtimeGraph,
        });
      });
    });
  });
});

function getGithubUserInformationAndTryKnownOldName(operations, dc, config, username, callback) {
  operations.getAccountByUsername(username, (error, account) => {
    if (error && error.statusCode === 404) {
      return tryGetGithubUserIdFromUsernameLink(dc, config, username, (tryGetError, userLink) => {
        if (tryGetError) {
          return callback(tryGetError);
        }
        return callback(null, userLink);
      });
    }
    if (error) {
      return callback(error);
    }
    callback(null, account);
  });
}

router.get('/whois/github/:username', function (req, res, next) {
  const config = req.app.settings.runtimeConfig;
  const operations = req.app.settings.providers.operations;
  const dc = req.app.settings.dataclient;
  const redisClient = req.app.settings.dataclient.cleanupInTheFuture.redisClient;
  const username = req.params.username;
  getGithubUserInformationAndTryKnownOldName(operations, dc, config, username, (error, userInfo) => {
    if (error) {
      error.skipLog = true;
      return next(error);
    }
    var id = userInfo.id || userInfo.ghid;
    whoisById(dc, config, id, userInfo, function (error, userInfoFinal) {
      expandAllInformation(req, dc, config, userInfoFinal, function(error, z) {
        var upn = userInfoFinal ? userInfoFinal.aadupn : 'unknown-upn';
        getPersonServiceEntryByUpn(redisClient, upn, (getInformationError, personEntry) => {
          getRealtimeAadIdInformation(req, z, (ignore, realtimeGraph) => {
            req.legacyUserContext.render(req, res, 'organization/whois/result', 'Whois: ' + (z.ghu || username), {
              info: z,
              personEntry: personEntry,
              realtimeGraph: realtimeGraph,
            });
          });
        });
      });
    });
  });
});

router.post('/whois/github/:username', function (req, res, next) {
  const config = req.app.settings.runtimeConfig;
  const dc = req.app.settings.dataclient;
  const username = req.params.username;
  // token: config.github.complianceToken || config.github.organizations[0].ownerToken
  const markAsServiceAccount = req.body['mark-as-service-account'];
  const unmarkServiceAccount = req.body['unmark-service-account'];
  const operations = req.app.settings.operations;
  operations.getAccountByUsername(username, (getError, userInfo) => {
    if (getError) {
      return next(getError);
    }
    const id = userInfo.id;
    whoisById(dc, config, id, userInfo, function (error, userInfoFinal) {
      if (userInfoFinal && userInfoFinal.githubInfoButNoLink !== undefined) {
        userInfoFinal.ghu = userInfoFinal.githubInfoButNoLink.login;
        userInfoFinal.ghid = userInfoFinal.githubInfoButNoLink.id;
      }
      if (markAsServiceAccount || unmarkServiceAccount) {
        return modifyServiceAccount(dc, userInfoFinal, markAsServiceAccount, req, res, next);
      }
      // TODO: restore pending unlink capability
      req.legacyUserContext.processPendingUnlink(userInfoFinal, (ignoredError, results) => {
        req.legacyUserContext.render(req, res, 'organization/whois/drop', `Dropped ${username}`, {
          results: results,
          entity: userInfoFinal,
        });
      });
    });
  });
});

function modifyServiceAccount(dc, linkSubset, markAsServiceAccount, req, res, next) {
  dc.getLink(linkSubset.ghid, function (findError, link) {
    if (findError) {
      return next(findError);
    }
    link = dc.reduceEntity(link);
    if (markAsServiceAccount) {
      link.serviceAccount = true;
    } else {
      delete link.serviceAccount;
    }
    dc.updateLink(linkSubset.ghid, link, (updateError) => {
      if (updateError) {
        return next(updateError);
      }
      req.legacyUserContext.invalidateLinkCache(link.aadoid || 'no-aad-oid', () => {
        res.json(link);
      });
    });
  });
}

module.exports = router;
