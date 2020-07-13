//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ReposAppRequest, IProviders } from '../../../../transitional';
import { wrapError } from '../../../../utils';
import { Team } from '../../../../business/team';
import { PermissionWorkflowEngine } from '../approvals';
import RenderHtmlMail from '../../../../lib/emailRender';
import { GetAddressFromUpnAsync } from '../../../../lib/mailAddressProvider';

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

router.post('/', asyncHandler(async function (req: ILocalRequest, res, next) {
  const engine = req.approvalEngine as PermissionWorkflowEngine;
  const approvalRequest = req.approvalEngine.request;
  const requestid = engine.id;
  const {
    approvalProvider: teamJoinApprovalProvider,
    config,
    mailAddressProvider,
    mailProvider,
  } = req.app.settings.providers as IProviders;
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
  if (!mailProvider) {
    return next(new Error('A mail provider has been requested but a provider instance could not be found.'));
  }
  // Approval workflow note: although the configuration may specify just a mail
  // provider today, there may actually be an issue that was opened at the time
  // of the request. So we will attempt to close any issues if the request has
  // an issue ID.
  const action = req.body.approveWithComment || req.body.approve ? 'approve' : 'deny';
  const bodyText = req.body.text;
  const username = req.individualContext.getGitHubIdentity().username;
  let friendlyErrorMessage = 'Whoa? What happened?';
  const pendingRequest = engine.request;
  const upn = pendingRequest.corporateUsername;
  let userMailAddress = null;
  try {
    userMailAddress = await GetAddressFromUpnAsync(mailAddressProvider, upn);
    pendingRequest.decision = action,
    pendingRequest.active = false;
    pendingRequest.decisionTime = new Date();
    pendingRequest.decisionThirdPartyUsername = username;
    pendingRequest.decisionThirdPartyId = req.individualContext.getGitHubIdentity().id;
    pendingRequest.decisionMessage = bodyText;
    pendingRequest.decisionCorporateUsername = req.individualContext.corporateIdentity.username;
    pendingRequest.decisionCorporateId = req.individualContext.corporateIdentity.id;
    friendlyErrorMessage = 'The approval request information could not be updated, indicating a data store problem potentially. The decision may not have been recorded.';
    await teamJoinApprovalProvider.updateTeamApprovalEntity(pendingRequest);
    if (action == 'approve') {
      await new Promise((resolve, reject) => {
        engine.performApprovalOperation((error: Error) => {
          return error ? reject(error) : resolve();
        });
      });
    }
    friendlyErrorMessage = null;
  } catch (error) {
    if (friendlyErrorMessage) {
      error = wrapError(error, friendlyErrorMessage);
    }
    return next(error);
  }
  let secondaryErrors = false;
  req.individualContext.webContext.saveUserAlert('Thanks for your ' + action.toUpperCase() + ' decision.', engine.typeName, 'success');
  if (mailProviderInUse) {
    const wasApproved = action === 'approve';
    const contentOptions = {
      correlationId: req.correlationId,
      pendingRequest,
      version: config.logging.version,
      results: [], // no longer a used field, used to be called 'output'
      wasApproved,
      decisionBy: username,
      decisionNote: bodyText,
      decisionEmail: req.individualContext.corporateIdentity.username,
      reason: (`You are receiving this e-mail because of a request that you created, and a decision has been made.
                This mail was sent to: ${pendingRequest.corporateUsername}`),
      headline: engine.getDecisionEmailHeadline(wasApproved),
      notification: wasApproved ? 'information' : 'warning',
      service: (config.brand?.companyName || 'Microsoft') + ' GitHub',
    };
    if (!engine.getDecisionEmailViewName || !engine.getDecisionEmailSubject) {
      return req.insights.trackException({
        exception: new Error('No getDecisionEmailViewName available with the engine.'),
        properties: Object.assign({ eventName: 'ReposRequestDecisionMailRenderFailure' }, contentOptions),
      });
    }
    const getDecisionEmailViewName = engine.getDecisionEmailViewName();
    let content = null;
    try {
      content = await RenderHtmlMail(req.app.settings.runtimeConfig.typescript.appDirectory, getDecisionEmailViewName, contentOptions);
    } catch (renderError) {
      req.insights.trackException({
        exception: renderError,
        properties: Object.assign({ eventName: 'ReposRequestDecisionMailRenderFailure' }, contentOptions),
      });
    }
    if (content) {
      const mail = {
        to: [ userMailAddress ],
        subject: engine.getDecisionEmailSubject(wasApproved, pendingRequest),
        content,
        correlationId: req.correlationId,
        category: ['decision', 'repos'],
      };
      try {
        const mailResult = await mailProvider.sendMail(mail);
        req.insights.trackEvent({ name: 'ReposRequestDecisionMailSuccess', properties: Object.assign({
          receipt: mailResult,
        }, contentOptions)});
      } catch (mailError) {
        req.insights.trackException({ exception: mailError, properties: Object.assign({
          eventName: 'ReposRequestDecisionMailFailure',
        }, contentOptions)});
      }
    }
  }
  return res.redirect(req.teamUrl);
}));

module.exports = router;
