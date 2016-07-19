//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const async = require('async');
const github = require('octonode');

// TODO: Refactor OSS user to better be able to remove the user using the central codepath.

// These functions are not pretty.

router.use(function ensureOrganizationSudoer(req, res, next) {
  req.oss.isPortalAdministrator(function (error, isAdmin) {
    if (isAdmin === true) {
      return next();
    }
    next(new Error('These aren\'t the droids you are looking for. You do not have permission to be here.'));
  });
});

router.get('/', function (req, res) {
  req.oss.render(req, res, 'organization/index', 'Organization Dashboard');
});

function whoisById(dc, config, githubId, userInfo, callback) {
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
  var oss = req.oss;
  var orgsList = oss.orgs();
  var orgsUserIn = [];
  async.each(orgsList, function (org, callback) {
    org.queryAnyUserMembership(entity.ghu, function (err, membership) {
      if (membership && membership.state) {
        orgsUserIn.push(org);
      }
      callback(null, membership);
    });
  }, function (expansionError) {
    entity.orgs = orgsUserIn;
    callback(expansionError, entity);
  });
  // team memberships
  // org(s) memberships
  // "drop from org"
  // "drop from all orgs"
  // "email"
}

router.get('/whois/aad/:upn', function (req, res, next) {
  var config = req.app.settings.runtimeConfig;
  var dc = req.app.settings.dataclient;
  var upn = req.params.upn;
  var oss = req.oss;
  dc.getUserByAadUpn(upn, function (error, usr) {
    if (error) {
      error.skipLog = true;
      return next(error);
    }
    if (usr.length && usr.length > 0) {
      expandAllInformation(req, dc, config, usr[0], function (error, z) {
        oss.render(req, res, 'organization/whois/result', 'Whois by AAD UPN: ' + upn, {
          info: z,
        });
      });
    } else {
      return next(new Error('User not found.'));
    }
  });
});

router.get('/errors/active', function (req, res, next) {
  var dc = req.app.settings.dataclient;
  var oss = req.oss;
  dc.getActiveErrors(function (error, errors) {
    if (error) {
      return next(error);
    }
    oss.render(req, res, 'organization/errorsList', 'Untriaged errors', {
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
      req.oss.saveUserAlert(req, 'Error ' + partitionKey + '/' + errorId + ' troaged.', 'Marked as no longer a new error instance', 'success');
      res.redirect('/organization/errors/active/');
    });
  } else if (action == 'Delete') {
    dc.removeError(partitionKey, errorId, function (error) {
      if (error) {
        return next(error);
      }
      req.oss.saveUserAlert(req, 'Error ' + partitionKey + '/' + errorId + ' deleted.', 'Deleted', 'success');
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
  var oss = req.oss;
  whoisById(dc, config, id, undefined, function (error, userInfoFinal) {
    expandAllInformation(req, dc, config, userInfoFinal, function (error, z) {
      oss.render(req, res, 'organization/whois/result', 'Whois by GitHub ID: ' + id, {
        info: z,
        postUrl: '/organization/whois/id/' + id,
      });
    });
  });
});

router.post('/whois/id/:githubid', function (req, res, next) {
  var config = req.app.settings.runtimeConfig;
  var dc = req.app.settings.dataclient;
  var id = req.params.githubid;
  var valid = req.body['remove-link-only'];
  if (!valid) {
    return next(new Error('Invalid action for the ID POST action.'));
  }
  whoisById(dc, config, id, undefined, function (error, userInfoFinal) {
    expandAllInformation(req, dc, config, userInfoFinal, function (whoisExpansionError) {
      if (whoisExpansionError) {
        return next(whoisExpansionError);
      }
      var tasks = [];
      tasks.push(function removeLinkNow(callback) {
        dc.removeLink(id, callback);
      });
      async.series(tasks, function (error, results) {
        res.send('<pre>' + JSON.stringify({
          error: error,
          results: results
        }, undefined, 2) + '</pre>');
      });
    });
  });
});

router.get('/whois/github/:username', function (req, res, next) {
  var config = req.app.settings.runtimeConfig;
  var dc = req.app.settings.dataclient;
  var username = req.params.username;
  var githubOrgClient = github.client(config.github.complianceToken);
  var ghuser = githubOrgClient.user(username);
  var oss = req.oss;
  ghuser.info(function (error, userInfo) {
    if (error) {
      error.skipLog = true;
      return next(error);
    }
    var id = userInfo.id;
    whoisById(dc, config, id, userInfo, function (error, userInfoFinal) {
      expandAllInformation(req, dc, config, userInfoFinal, function (error, z) {
        oss.render(req, res, 'organization/whois/result', 'Whois: ' + z.ghu, {
          info: z,
        });
      });
    });
  });
});

function generateRemoveMembershipFunction(dc, config, username, org) {
  var theOrg = org;
  return function (callback) {
    var o = theOrg;
    o.removeUserMembership(username, callback);
  };
}

router.post('/whois/github/:username', function (req, res, next) {
  var config = req.app.settings.runtimeConfig;
  var dc = req.app.settings.dataclient;
  var username = req.params.username;
  var githubOrgClient = github.client(config.github.complianceToken);
  var ghuser = githubOrgClient.user(username);
  var valid = req.body['remove-all'] || req.body['remove-link-only'] || req.body['remove-primary-org'];
  if (!valid) {
    return next(new Error('Invalid action.'));
  }
  ghuser.info(function (error, userInfo) {
    if (error) {
      return next(error);
    }
    var id = userInfo.id;
    whoisById(dc, config, id, userInfo, function (error, userInfoFinal) {
      expandAllInformation(req, dc, config, userInfoFinal, function (error, u) {
        var removeAllOrgs = req.body['remove-all'];
        var removePrimaryOnly = req.body['remove-primary-org'];
        var removeLink = !removePrimaryOnly; // Only if we know they have a link
        var tasks = [];
        if (removeAllOrgs && u.orgs && u.orgs.length > 0) {
          u.orgs.reverse(); // want to end with the primary organization
          for (var i = 0; i < u.orgs.length; i++) {
            var org = u.orgs[i];
            tasks.push(generateRemoveMembershipFunction(dc, config, username, org));
          }
        } else if (removePrimaryOnly) {
          // When there is no link... edge case.
          // EDGE CASE: This may need an update.
          tasks.push(generateRemoveMembershipFunction(dc, config, username, config.github.organization));
        }
        if (removeLink) {
          tasks.push(function removeLinkNow(callback) {
            dc.removeLink(id, callback);
          });
        }
        async.series(tasks, function (error, results) {
          res.send('<pre>' + JSON.stringify({
            error: error,
            results: results
          }, undefined, 2) + '</pre>');
        });
      });
    });
  });
});

module.exports = router;
