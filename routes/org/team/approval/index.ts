//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express = require('express');
const router = express.Router();

import async = require('async');

import { ReposAppRequest, IProviders } from '../../../../transitional';
import { wrapError } from '../../../../utils';
import { Operations } from '../../../../business/operations';
import { Team } from '../../../../business/team';
import { PermissionWorkflowEngine } from '../approvals';
const emailRender = require('../../../../lib/emailRender');

interface ILocalRequest extends ReposAppRequest {
  team2?: any;
  approvalEngine?: PermissionWorkflowEngine;
  teamUrl?: any;
}

router.get('/', function (req: ILocalRequest, res) {
  const approvalRequest = req.approvalEngine.request;
  const team2 = req.team2 as Team;
  // Ignoring any errors for now.
  if (approvalRequest.created) {
    // legacy compat, can remove with a view update
    approvalRequest['requestedTime'] = approvalRequest.created;
  }
  req.individualContext.webContext.render({
    view: 'org/team/approveStatus',
    title: 'Request Status',
    state: {
      metadata: approvalRequest,
      requestingUser: req.approvalEngine.user,
      team: team2,
      teamUrl: req.teamUrl,
    },
  });
});

router.get('/setNote/:action', function (req: ILocalRequest, res) {
  var engine = req.approvalEngine;
  var action = req.params.action;
  if (action == 'approveWithComment') {
    action = 'approve';
  }
  const team2 = req.team2;
  req.individualContext.webContext.render({
    view: 'org/team/approveStatusWithNote',
    title: 'Record your comment for request ' + engine.id + ' (' + action + ')',
    state: {
      metadata: engine.request,
      action: action,
      requestingUser: engine.user,
      team: team2,
      teamUrl: req.teamUrl,
    },
  });
});

router.post('/', function (req: ILocalRequest, res, next) {
  const engine = req.approvalEngine as PermissionWorkflowEngine;
  const approvalRequest = req.approvalEngine.request;
  const requestid = engine.id;
  const providers = req.app.settings.providers as IProviders;
  const teamJoinApprovalProvider = providers.approvalProvider;
  const config = req.app.settings.runtimeConfig;
  if (!req.body.text && req.body.deny) {
    return res.redirect(req.teamUrl + 'approvals/' + requestid + '/setNote/deny');
  }
  if (req.body.reopen) {
    approvalRequest.active = true;
    teamJoinApprovalProvider.updateTeamApprovalEntity(approvalRequest).then(ok => {
      req.individualContext.webContext.saveUserAlert('Request re-opened.', engine.typeName, 'success');
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
  if (!mailProviderInUse) {
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

  const username = req.individualContext.getGitHubIdentity().username;
  var friendlyErrorMessage = 'Whoa? What happened?';
  var pendingRequest = engine.request;
  let userMailAddress = null;
  async.waterfall([
    function getMailAddressForUser(callback) {
      const upn = pendingRequest.corporateUsername;
      mailAddressProvider.getAddressFromUpn(upn, (resolveError, mailAddress) => {
        if (resolveError) {
          return callback(resolveError);
        }
        userMailAddress = mailAddress;
        callback();
      });
    },
    function updateRequest() {
      const callback = arguments[arguments.length - 1];

      pendingRequest.decision = action,
      pendingRequest.active = false;
      pendingRequest.decisionTime = new Date();
      pendingRequest.decisionThirdPartyUsername = username;
      pendingRequest.decisionThirdPartyId = req.individualContext.getGitHubIdentity().id;
      pendingRequest.decisionMessage = bodyText;
      pendingRequest.decisionCorporateUsername = req.individualContext.corporateIdentity.username;
      pendingRequest.decisionCorporateId = req.individualContext.corporateIdentity.id;

      friendlyErrorMessage = 'The approval request information could not be updated, indicating a data store problem potentially. The decision may not have been recorded.';

      teamJoinApprovalProvider.updateTeamApprovalEntity(pendingRequest).then(ok => {
        return callback();
      }).catch(error => {
        return callback(error);
      });
    },
    function performApprovalOperations() {
      const callback = arguments[arguments.length - 1];
      if (action == 'approve') {
        engine.performApprovalOperation(callback);
      } else {
        callback();
      }
    },
    function () {
      friendlyErrorMessage = null;
      const callback = arguments[arguments.length - 1];
      return callback();
    },
  ], function (error, output: string[]) {
    if (error) {
      if (friendlyErrorMessage) {
        error = wrapError(error, friendlyErrorMessage);
      }
      return next(error);
    }
    var secondaryErrors = false;
    if (output && output.length) {
      output.forEach((secondaryResult: any) => {
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
            req.insights.trackException({ exception: secondaryResult.error, properties: extraInfo });
          } catch (unusedError) {
            // never want this to fail
          }
        }
      });
    }
    req.individualContext.webContext.saveUserAlert('Thanks for your ' + action.toUpperCase() + ' decision.', engine.typeName, 'success');
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
        decisionEmail: req.individualContext.corporateIdentity.username,
        reason: (`You are receiving this e-mail because of a request that you created, and a decision has been made.
                  This mail was sent to: ${pendingRequest.corporateUsername}`),
        headline: engine.getDecisionEmailHeadline(wasApproved),
        notification: wasApproved ? 'information' : 'warning',
        service: 'Microsoft GitHub',
      };
      if (!engine.getDecisionEmailViewName || !engine.getDecisionEmailSubject) {
        return req.insights.trackException({
          exception: new Error('No getDecisionEmailViewName available with the engine.'),
          properties: Object.assign({ eventName: 'ReposRequestDecisionMailRenderFailure' }, contentOptions),
        });
      }
      const getDecisionEmailViewName = engine.getDecisionEmailViewName();
      emailRender.render(req.app.settings.runtimeConfig.typescript.appDirectory, getDecisionEmailViewName, contentOptions, (renderError, mailContent) => {
        if (renderError) {
          return req.insights.trackException({
            exception: renderError,
            properties: Object.assign({ eventName: 'ReposRequestDecisionMailRenderFailure' }, contentOptions),
          });
        }
        // TODO: remove spike: adding the GitHub admin alias if there is a secondary failure
        var recipients = [userMailAddress];
        if (secondaryErrors) {
          recipients.push('github-admin@microsoft.com');
        }
        const mail = {
          to: recipients,
          subject: engine.getDecisionEmailSubject(wasApproved, pendingRequest),
          content: mailContent,
          correlationId: req.correlationId,
          category: ['decision', 'repos'],
        };
        mailProvider.sendMail(mail, (mailError, mailResult) => {
          var customData = Object.assign({
            receipt: mailResult,
            eventName: undefined,
          }, contentOptions);
          if (mailError) {
            customData.eventName = 'ReposRequestDecisionMailFailure';
            req.insights.trackException({ exception: mailError, properties: customData });
          } else {
            req.insights.trackEvent({ name: 'ReposRequestDecisionMailSuccess', properties: customData });
          }
        });
      });
    }
    if (mailProviderInUse) {
      sendDecisionMail();
    }
    return res.redirect(req.teamUrl);
  });
});

module.exports = router;
