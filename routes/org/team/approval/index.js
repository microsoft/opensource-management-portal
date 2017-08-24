//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();

const async = require('async');
const emailRender = require('../../../../lib/emailRender');
const utils = require('../../../../utils');

function teamsInfoFromRequest(operations, team2, approvalRequest, callback) {
  if (approvalRequest.teamsCount) {
    var count = parseInt(approvalRequest.teamsCount, 10);
    var detailedTeams = [];
    for (var i = 0; i < count; i++) {
      var key = 'teamid' + i;
      if (approvalRequest[key] && approvalRequest[key + 'p']) {
        detailedTeams.push({
          id: approvalRequest[key],
          permission: approvalRequest[key + 'p'],
        });
      }
    }
    async.map(detailedTeams, function (basic, cb) {
      var permission = basic.permission;
      operations.getTeamById(basic.id, function (error, teamInstance) {
        if (teamInstance) {
          teamInstance._temporary_permission = permission;
        }
        cb(error, teamInstance);
      });
    }, callback);
  } else {
    callback();
  }
}

router.get('/', function (req, res) {
  var approvalRequest = req.approvalEngine.request;
  const team2 = req.team2;
  const operations = req.app.settings.providers.operations;
  teamsInfoFromRequest(operations, team2, approvalRequest, function (error, expandedTeamInfo) {
    // Ignoring any errors for now.
    if (approvalRequest.requested) {
      var asInt = parseInt(approvalRequest.requested, 10);
      approvalRequest.requestedTime = new Date(asInt);
    }
    if (approvalRequest.decisionTime) {
      approvalRequest.decisionTime = new Date(parseInt(approvalRequest.decisionTime, 10));
    }
    req.legacyUserContext.render(req, res, 'org/team/approveStatus', 'Request Status', {
      entry: approvalRequest,
      requestingUser: req.approvalEngine.user,
      expandedTeamInfo: expandedTeamInfo,
      team: team2,
      teamUrl: req.teamUrl,
    });
  });
});

router.get('/edit', function (req, res, next) {
  var approvalEngine = req.approvalEngine;
  if (approvalEngine.editGet) {
    return approvalEngine.editGet(req, res, next);
  }
  next(new Error('Editing is not supported for this request type.'));
});

router.post('/edit', function (req, res, next) {
  var approvalEngine = req.approvalEngine;
  if (approvalEngine.editPost) {
    return approvalEngine.editPost(req, res, next);
  }
  next(new Error('Editing is not supported for this request type.'));
});

router.get('/setNote/:action', function (req, res) {
  var engine = req.approvalEngine;
  var action = req.params.action;
  if (action == 'approveWithComment') {
    action = 'approve';
  }
  const team2 = req.team2;
  req.legacyUserContext.render(req, res, 'org/team/approveStatusWithNote', 'Record your comment for request ' + engine.id + ' (' + action + ')', {
    entry: engine.request,
    action: action,
    requestingUser: engine.user,
    team: team2,
    teamUrl: req.teamUrl,
  });
});

router.post('/', function (req, res, next) {
  var engine = req.approvalEngine;
  var requestid = engine.id;
  var team = engine.team;
  const organization = req.organization;
  var dc = req.app.settings.dataclient;
  const config = req.app.settings.runtimeConfig;
  if (!req.body.text && req.body.deny) {
    return res.redirect(req.teamUrl + 'approvals/' + requestid + '/setNote/deny');
  }
  if (req.body.reopen) {
    req.legacyUserContext.saveUserAlert(req, 'Request re-opened.', engine.typeName, 'success');
    return dc.updateApprovalRequest(requestid, {
      active: true
    }, function () {
      res.redirect(req.teamUrl + 'approvals/' + requestid);
    });
  }
  if (!req.body.text && req.body.approveWithComment) {
    return res.redirect(req.teamUrl + 'approvals/' + requestid + '/setNote/approveWithComment');
  }
  const repoApprovalTypesValues = config.github.approvalTypes.repo;
  if (repoApprovalTypesValues.length === 0) {
    return next(new Error('No repo approval providers configured.'));
  }
  const repoApprovalTypes = new Set(repoApprovalTypesValues);
  const mailProviderInUse = repoApprovalTypes.has('mail');
  var issueProviderInUse = repoApprovalTypes.has('github');
  if (!mailProviderInUse && !issueProviderInUse) {
    return next(new Error('No configured approval providers configured.'));
  }
  const mailProvider = req.app.settings.mailProvider;
  if (!mailProvider) {
    return next(new Error('A mail provider has been requested but a provider instance could not be found.'));
  }
  const mailAddressProvider = req.app.settings.mailAddressProvider;
  // Approval workflow note: although the configuration may specify just a mail
  // provider today, there may actually be an issue that was opened at the time
  // of the request. So we will attempt to close any issues if the request has
  // an issue ID.
  var action = req.body.approveWithComment || req.body.approve ? 'approve' : 'deny';
  var bodyText = req.body.text;

  const username = req.legacyUserContext.usernames.github;
  var friendlyErrorMessage = 'Whoa? What happened?';
  var pendingRequest = engine.request;
  var notificationRepo = null;
  var issueId = pendingRequest.issue;
  var userMailAddress = null;
  try {
    if (issueId) {
      notificationRepo = organization.legacyNotificationsRepository;
    }
  } catch (noWorkflowRepoError) {
    // No provider configured
    issueId = undefined;
    issueProviderInUse = false;
  }
  var issue = null;
  async.waterfall([
    function getMailAddressForUser(callback) {
      const upn = pendingRequest.email;
      mailAddressProvider.getAddressFromUpn(upn, (resolveError, mailAddress) => {
        if (resolveError) {
          return callback(resolveError);
        }
        userMailAddress = mailAddress;
        callback();
      });
    },
    function commentOnIssue(callback) {
      if (!issueId) {
        return callback();
      }
      issue = notificationRepo.issue(issueId);
      var bodyAddition = engine.messageForAction(action);
      if (bodyText !== undefined) {
        bodyAddition += '\n\nA note was included with the decision and can be viewed by team maintainers and the requesting user.';
      }
      var comment = bodyAddition + '\n\n<small>This was generated by the Open Source Portal on behalf of ' +
        username + '.</small>';
      if (pendingRequest.ghu) {
        comment += '\n\n' + 'FYI, @' + pendingRequest.ghu + '\n';
      }
      friendlyErrorMessage = 'While trying to comment on issue #' + issue.number + ', an error occurred.';
      issue.createComment(comment, (commentError) => {
        if (commentError && mailProviderInUse) {
          issue = null;
          issueProviderInUse = false;
        }
        callback(commentError);
      });
    },
    function updateRequest() {
      var callback = arguments[arguments.length - 1];
      var requestUpdates = {
        decision: action,
        active: false,
        decisionTime: (new Date().getTime()).toString(),
        decisionBy: username,
        decisionNote: bodyText,
        decisionEmail: req.legacyUserContext.modernUser().contactEmail(),
      };
      var updatedRequest = Object.assign({}, pendingRequest);
      Object.assign(updatedRequest, requestUpdates);
      friendlyErrorMessage = 'The approval request information could not be updated, indicating a data store problem potentially. The decision may not have been recorded.';
      dc.replaceApprovalRequest(requestid, updatedRequest, callback);
    },
    function performApprovalOperations() {
      var callback = arguments[arguments.length - 1];
      if (action == 'approve') {
        engine.performApprovalOperation(callback);
      } else {
        callback();
      }
    },
    function closeIssue() {
      var callback = arguments[arguments.length - 1];
      if (!issue) {
        return callback();
      }
      friendlyErrorMessage = 'The issue #' + issue.number + ' that tracks the request could not be closed.';
      issue.close(callback);
    },
    function () {
      friendlyErrorMessage = null;
      var callback = arguments[arguments.length - 1];
      if (action == 'approve' && engine.generateSecondaryTasks) {
        engine.generateSecondaryTasks(callback);
      } else {
        callback();
      }
    },
    // Secondary tasks run after the primary and in general will not
    // fail the approval operation. By sending an empty error callback
    // but then an object with an error property set, the operation
    // that failed can report status. Whether an error or not, a
    // message property will be shown for each task result.
    function () {
      friendlyErrorMessage = null;
      var tasks = arguments.length > 1 ? arguments[0] : [];
      var callback = arguments[arguments.length - 1];
      async.series(tasks, callback);
    },
  ], function (error, output) {
    if (error) {
      if (friendlyErrorMessage) {
        error = utils.wrapError(error, friendlyErrorMessage);
      }
      return next(error);
    }
    var secondaryErrors = false;
    if (output && output.length) {
      output.forEach((secondaryResult) => {
        if (secondaryResult.error) {
          secondaryErrors = true;
          try {
            var extraInfo = {
              eventName: 'ReposRequestSecondaryTaskError',
            };
            if (secondaryResult.error.data) {
              Object.assign(extraInfo, secondaryResult.error.data);
            }
            if (secondaryResult.error.headers) {
              Object.assign(extraInfo, secondaryResult.error.headers);
            }
            req.insights.trackException(secondaryResult.error, extraInfo);
          } catch (unusedError) {
            // never want this to fail
          }
        }
      });
    }
    req.legacyUserContext.saveUserAlert(req, 'Thanks for processing the request with your ' + action.toUpperCase() + ' decision.', engine.typeName, 'success');
    function sendDecisionMail() {
      const wasApproved = action == 'approve';
      const contentOptions = {
        correlationId: req.correlationId,
        pendingRequest: pendingRequest,
        version: config.logging.version,
        results: output,
        wasApproved: wasApproved,
        decisionBy: username,
        decisionNote: bodyText,
        decisionEmail: req.legacyUserContext.modernUser().contactEmail(),
      };
      if (!engine.getDecisionEmailViewName || !engine.getDecisionEmailSubject) {
        return req.insights.trackException(new Error('No getDecisionEmailViewName available with the engine.'), Object.assign({
          eventName: 'ReposRequestDecisionMailRenderFailure',
        }, contentOptions));
      }
      const getDecisionEmailViewName = engine.getDecisionEmailViewName();
      emailRender.render(req.app.settings.basedir, getDecisionEmailViewName, contentOptions, (renderError, mailContent) => {
        if (renderError) {
          return req.insights.trackException(renderError, Object.assign({
            eventName: 'ReposRequestDecisionMailRenderFailure',
          }, contentOptions));
        }
        // TODO: remove spike: adding the GitHub admin alias if there is a secondary failure
        var recipients = [userMailAddress];
        if (secondaryErrors) {
          recipients.push('github-admin@microsoft.com');
        }
        const mail = {
          to: recipients,
          subject: engine.getDecisionEmailSubject(wasApproved, pendingRequest),
          reason: (`You are receiving this e-mail because of a request that you created, and a decision has been made.
                    This mail was sent to: ${pendingRequest.email}`),
          content: mailContent,
          headline: engine.getDecisionEmailHeadline(wasApproved, pendingRequest),
          classification: wasApproved ? 'information' : 'warning',
          service: 'Microsoft GitHub',
          correlationId: req.correlationId,
        };
        mailProvider.sendMail(mail, (mailError, mailResult) => {
          var customData = Object.assign({
            receipt: mailResult,
          }, contentOptions);
          if (mailError) {
            customData.eventName = 'ReposRequestDecisionMailFailure';
            req.insights.trackException(mailError, customData);
          } else {
            req.insights.trackEvent('ReposRequestDecisionMailSuccess', customData);
          }
        });
      });
    }
    if (mailProviderInUse) {
      sendDecisionMail();
    }
    if (action !== 'approve' || !engine.getApprovedViewName) {
      return res.redirect(req.teamUrl);
    }
    req.legacyUserContext.render(req, res, engine.getApprovedViewName(), 'Approved', {
      pendingRequest: pendingRequest,
      results: output,
      team: team,
      teamUrl: req.teamUrl,
    });
  });
});

module.exports = router;
