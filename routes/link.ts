//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

const emailRender = require('../lib/emailRender');
import express = require('express');
import { ReposAppRequest } from '../transitional';
import { IndividualContext } from '../business/context2';
import { ILinkProvider } from '../lib/linkProviders/postgres/postgresLinkProvider';
import { storeOriginalUrlAsReferrer, wrapError } from '../utils';
import { ICorporateLink } from '../business/corporateLink';

const isEmail = require('validator/lib/isEmail');

const router = express.Router();

const unlinkRoute = require('./unlink');

interface IRequestWithSession extends ReposAppRequest {
  session?: any;
}

interface IRequestHacked extends ReposAppRequest {
  overrideLinkUserPrincipalName?: any;
}

router.use((req: IRequestHacked, res, next) => {
  const config = req.app.settings.runtimeConfig;
  if (config && config.github && config.github.links && config.github.links.provider && config.github.links.provider.linkingOfflineMessage) {
    return next(new Error(`Linking is temporarily offline: ${config.github.links.provider.linkingOfflineMessage}`));
  } else {
    return next();
  }
});

router.use('/', function (req: ReposAppRequest, res, next) {
  // Make sure both account types are authenticated before showing the link pg [wi 12690]
  const individualContext = req.individualContext;
  if (!individualContext.corporateIdentity || !individualContext.getGitHubIdentity()) {
    req.insights.trackEvent({ name: 'PortalSessionNeedsBothGitHubAndAadUsernames' });
    return res.redirect('/?signin');
  }
  return next();
});

// TODO: graph provider non-guest check should be middleware and in the link business process

router.use((req: IRequestHacked, res, next) => {
  const individualContext = req.individualContext as IndividualContext;
  const providers = req.app.settings.providers;
  const insights = providers.insights;
  const config = providers.config;
  let validateAndBlockGuests = false;
  if (config && config.activeDirectory && config.activeDirectory.blockGuestUserTypes) {
    validateAndBlockGuests = true;
  }
  // If the app has not been configured to check whether a user is a guest before linking, continue:
  if (!validateAndBlockGuests) {
    return next();
  }
  const aadId = individualContext.corporateIdentity.id;
  // If the app is configured to check guest status, do this now, before linking:
  const graphProvider = providers.graphProvider;
  // REFACTOR: delegate the decision to the auth provider
  if (!graphProvider || !graphProvider.getUserById) {
    return next(new Error('User type validation cannot be performed because there is no graphProvider configured for this type of account'));
  }
  insights.trackEvent({
    name: 'LinkValidateNotGuestStart',
    properties: {
      aadId: aadId,
    },
  });
  graphProvider.getUserById(aadId, (graphError, details) => {
    if (graphError) {
      insights.trackException({
        exception: graphError,
        properties: {
          aadId: aadId,
          name: 'LinkValidateNotGuestGraphFailure',
        },
      });
      return next(graphError);
    }
    const userType = details.userType;
    const displayName = details.displayName;
    const userPrincipalName = details.userPrincipalName;
    let block = userType === 'Guest';
    let blockedRecord = block ? 'BLOCKED' : 'not blocked';
    // If the app is configured to check for guests, but this is a specifically permitted guest user, continue:
    if (config && config.activeDirectoryGuests && config.activeDirectoryGuests.authorizedIds && config.activeDirectoryGuests.authorizedIds.length && config.activeDirectoryGuests.authorizedIds.includes(aadId)) {
      block = false;
      blockedRecord = 'specifically authorized user ' + aadId + ' ' + userPrincipalName;
      /// HACK !
      req.overrideLinkUserPrincipalName = userPrincipalName;
      return next(new Error('This feature is not currently available. Please reach out to support to re-enable this feature.'));
    }
    insights.trackEvent({
      name: 'LinkValidateNotGuestGraphSuccess',
      properties: {
        aadId: aadId,
        userType: userType,
        displayName: displayName,
        userPrincipalName: userPrincipalName,
        blocked: blockedRecord,
      },
    });
    if (block) {
      insights.trackMetric({ name: 'LinksBlockedForGuests', value: 1 });
      return next(new Error(`This system is not available to guests. You are currently signed in as ${displayName} ${userPrincipalName}. Please sign out or try a private browser window.`));
    }
    return next();
  });
});

router.get('/', function (req: ReposAppRequest, res, next) {
  const individualContext = req.individualContext;
  const link = individualContext.link;
  if (!individualContext.corporateIdentity && !individualContext.getGitHubIdentity()) {
    req.insights.trackEvent({ name: 'PortalSessionNeedsBothGitHubAndAadUsernames' });
    return res.redirect('/?signin');
  }
  if (!individualContext.getGitHubIdentity()) {
    req.insights.trackEvent({ name: 'PortalSessionNeedsGitHubUsername' });
    return res.redirect('/signin/github/');
  }
  if (!link) {
    showLinkPage(req, res);
  } else {
    req.insights.trackEvent({ name: 'LinkRouteLinkLocated' });
    return individualContext.webContext.render({
      view: 'linkConfirmed',
      title: 'You\'re already linked',
    });
  }
});

function showLinkPage(req, res) {
  const individualContext = req.individualContext as IndividualContext;
  function render(options) {
    individualContext.webContext.render({
      view: 'link',
      title: 'Link GitHub with corporate identity',
      optionalObject: options || {},
    })
  }
  const config = req.app.settings.runtimeConfig;
  const graphProvider = req.app.settings.graphProvider;
  if (config.authentication.scheme !== 'aad' || !graphProvider){
    return render(null);
  }
  const aadId = individualContext.corporateIdentity.id;
  graphProvider.getUserAndManagerById(aadId, (error, graphUser) => {
    // By design, we want to log the errors but do not want any individual
    // lookup problem to break the underlying experience of letting a user
    // link. This is important if someone is new in the company, they may
    // not be in the graph fully yet.
    if (error) {
      req.insights.trackException({
        exception: error,
        properties: {
          event: 'PortalLinkInformationGraphLookupError',
        },
      });
    } else if (graphUser) {
      req.insights.trackEvent({ name: graphUser.manager ? 'PortalLinkInformationGraphLookupUser' : 'PortalLinkInformationGraphLookupServiceAccount' });
    }
    render({
      graphUser: graphUser,
      isServiceAccountCandidate: graphUser && !graphUser.manager,
    });
  });
}

router.get('/enableMultipleAccounts', function (req: IRequestWithSession, res) {
  // LEGACY
  // TODO: is this code still ever really used?
  if (req.user.github) {
    req.session.enableMultipleAccounts = true;
    return res.redirect('/link/cleanup');
  }
  req.insights.trackEvent({ name: 'PortalUserEnabledMultipleAccounts' });
  storeOriginalUrlAsReferrer(req, res, '/auth/github', 'multiple accounts enabled need to auth with GitHub again now');
});

router.post('/', linkUser);

function sendWelcomeMailThenRedirect(req: ReposAppRequest, res, config, url, linkObject: ICorporateLink, mailProvider, linkedAccountMail) {
  res.redirect(url);

  if (!mailProvider || !linkedAccountMail) {
    return;
  }

  const to = [
    linkedAccountMail,
  ];
  const toAsString = to.join(', ');

  const cc = [];
  if (config.brand && config.brand.operationsEmail && linkObject.isServiceAccount) {
    cc.push(config.brand.operationsEmail);
  }

  const mail = {
    to: to,
    subject: `${linkObject.corporateUsername} linked to ${linkObject.thirdPartyUsername}`,
    correlationId: req.correlationId,
    category: ['link', 'repos'],
    content: undefined,
  };
  const contentOptions = {
    reason: (`You are receiving this one-time e-mail because you have linked your account.
              To stop receiving these mails, you can unlink your account.
              This mail was sent to: ${toAsString}`),
    headline: `Welcome to GitHub, ${linkObject.thirdPartyUsername}`,
    notification: 'information',
    app: `${config.brand.companyName} GitHub`,
    companyName: config.brand.companyName,
    docs: config.microsoftOpenSource.docs,
    correlationId: req.correlationId,
    link: linkObject,
  };
  emailRender.render(req.app.settings.runtimeConfig.typescript.appDirectory, 'link', contentOptions, (renderError, mailContent) => {
    if (renderError) {
      return req.insights.trackException({
        exception: renderError,
        properties: {
          content: contentOptions,
          eventName: 'LinkMailRenderFailure',
        },
      });
    }
    mail.content = mailContent;
    mailProvider.sendMail(mail, (mailError, mailResult) => {
      const customData = {
        content: contentOptions,
        receipt: mailResult,
        eventName: undefined,
      };
      if (mailError) {
        customData.eventName = 'LinkMailFailure';
        return req.insights.trackException({ exception: mailError, properties: customData });
      }
      return req.insights.trackEvent({ name: 'LinkMailSuccess', properties: customData });
    });
  });
}

function linkUser(req, res, next) {
  const individualContext = req.individualContext as IndividualContext;

  // TODO: a business object should actually handle creating links with the provider
  const linkProvider = req.app.settings.providers.linkProvider as ILinkProvider;
  if (!linkProvider) {
    return next(new Error('No link provider'));
  }

  const config = req.app.settings.runtimeConfig;
  const isServiceAccount = req.body.sa === '1';
  const serviceAccountMail = req.body.serviceAccountMail;
  const linkedAccountMail = req.body.sam;
  const operations = req.app.settings.providers.operations;
  const mailProvider = req.app.settings.mailProvider;
  if (isServiceAccount && !isEmail(serviceAccountMail)) {
    return next(wrapError(null, 'Please enter a valid e-mail address for the Service Account maintainer.', true));
  }
  req.insights.trackEvent({ name: isServiceAccount ? 'PortalUserLinkingServiceAccountStart' : 'PortalUserLinkingStart' });
  const metricName = isServiceAccount ? 'PortalServiceAccountLinks' : 'PortalUserLinks';

  let newLinkObject: ICorporateLink = null;
  try {
    newLinkObject = individualContext.createGitHubLinkObject();
  } catch (missingInformationError) {
    return next(missingInformationError);
  }

  if (isServiceAccount) {
    newLinkObject.isServiceAccount = true;
    newLinkObject.serviceAccountMail = serviceAccountMail;
  }

  linkProvider.createLink(newLinkObject, (createError, linkId) => {
    if (createError) {
      req.insights.trackException({
        exception: createError,
        properties: {
          event: 'PortalUserLinkInsertLinkError',
        },
      });
      return next(wrapError(createError, `We had trouble linking your corporate and GitHub accounts: ${createError.message}`));
    }
    const eventData = newLinkObject;
    eventData['linkId'] = linkId;

    req.insights.trackEvent({ name: 'PortalUserLink' });
    req.insights.trackMetric({ name: metricName, value: 1 });

    // TODO: fireLinkEvent may need to recognize the new format!
    operations.fireLinkEvent(eventData);
    sendWelcomeMailThenRedirect(req, res, config, '/?onboarding=yes', newLinkObject, mailProvider, linkedAccountMail);
  });
}

router.use('/remove', unlinkRoute);

router.get('/reconnect', function (req: ReposAppRequest, res, next) {
  const config = req.app.settings.runtimeConfig;
  if (config.authentication.scheme !== 'aad'){
    return next(wrapError(null, 'Account reconnection is only needed for Active Directory authentication applications.', true));
  }
  // If the request comes back to the reconnect page, the authenticated app will
  // actually update the link the next time around.
  const ghi = req.individualContext.getGitHubIdentity();
  const hasToken = !!req.individualContext.webContext.tokens.gitHubReadToken;
  if (ghi && ghi.id && ghi.username && hasToken) {
    req.insights.trackEvent({ name: 'PortalUserReconnected' });
    return res.redirect('/');
  }
  req.insights.trackEvent({ name: 'PortalUserReconnectNeeded' });
  req.individualContext.webContext.render({
    view: 'reconnectGitHub',
    title: 'Please sign in with GitHub',
    state: {
      expectedUsername: ghi.username,
    },
  });
});

module.exports = router;
