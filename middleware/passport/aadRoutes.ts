//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';
import { PassportStatic } from 'passport';
import { type IReposApplication, type IReposError, ReposAppRequest } from '../../interfaces';
import { getProviders } from '../../lib/transitional';
import { isCodespacesAuthenticating } from '../../lib/utils';
import { IPrimaryAuthenticationHelperMethods } from '../passport-routes';
import { aadStrategyUserPropertyName } from './aadStrategy';

const aadPassportStrategyName = 'azure-active-directory';

export function attachAadPassportRoutes(
  app: IReposApplication,
  config: any,
  passport: PassportStatic,
  helpers: IPrimaryAuthenticationHelperMethods
) {
  const signinPath = isCodespacesAuthenticating(config, 'aad') ? 'sign-in' : 'signin';
  app.get(`/${signinPath}`, function (req: ReposAppRequest, res: Response, next: NextFunction) {
    if (req.isAuthenticated()) {
      const username = req.user?.azure?.username;
      if (username) {
        // Do not sign in yet again
        const nextDestination = req.headers?.referer || '/';
        return res.redirect(nextDestination);
      }
    }
    return helpers.storeReferrer(req, res, '/auth/azure', 'signin page hit, need to go authenticate');
  });

  // SameSite cookie auth fixes, will regenerate even more sessions before proceeding to redirect to AAD...
  app.get('/auth/azure', (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const currentlyStoredSessionReferer = (req as any).session?.referer || undefined;
    const additionalAuthRedirect = (req.session as any).additionalAuthRedirect;
    if (!req.session) {
      return next();
    }
    return req.session.regenerate(function (err) {
      if (err) {
        return next(err);
      }
      if (currentlyStoredSessionReferer && req.session) {
        (req as any).session.referer = currentlyStoredSessionReferer;
      }
      if (additionalAuthRedirect && req.session) {
        (req as any).session.additionalAuthRedirect = additionalAuthRedirect;
      }
      return next();
    });
  });

  app.get(
    '/auth/azure',
    passport.authenticate(aadPassportStrategyName, {
      keepSessionInfo: true /* we manually regenerate for XSS */,
    })
  );

  app.post(
    '/auth/azure/callback',
    passport.authenticate(aadPassportStrategyName, {
      keepSessionInfo: true /* we manually regenerate for XSS */,
    }),
    helpers.newSessionAfterAuthentication,
    (req: ReposAppRequest, res: Response, next: NextFunction) => {
      helpers.afterAuthentication(
        true /* primary app authentication */,
        aadStrategyUserPropertyName,
        req,
        res,
        next
      );
    }
  );

  // HTTP GET at the callback URL is used for a warning for certain users who launch
  // links from apps that temporarily prevent sessions. Technically this seems to
  // impact Windows users who use Word to open links to the site. Collecting
  // telemetry for now.
  app.get('/auth/azure/callback', (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const { insights } = getProviders(req);
    const isAuthenticated = req.isAuthenticated();
    insights?.trackEvent({
      name: 'PassportAzureADFailureInvalidStateFailure',
      properties: {
        requestType: 'HTTP GET',
        originalUrl: req.originalUrl,
        isAuthenticated: isAuthenticated,
      },
    });
    const messageError: IReposError = new Error(
      isAuthenticated
        ? 'Authentication initially failed, but you are good to go now.'
        : 'Authentication failed, possibly due to SameSite cookie issues with newer browsers.'
    );
    messageError.skipLog = true;
    messageError.status = 400;
    if (isAuthenticated) {
      return res.redirect('/');
    } else {
      messageError.fancyLink = {
        link: '/auth/azure',
        title: 'Try signing in again',
      };
    }
    return next(messageError);
  });

  app.get(`/${signinPath}/azure`, function (req: ReposAppRequest, res: Response) {
    helpers.storeReferrer(
      req,
      res,
      '/auth/azure',
      `request for the /${signinPath}/azure page, need to authenticate`
    );
  });

  app.get('/signout/azure', (req: ReposAppRequest, res: Response, next: NextFunction) => {
    return helpers.signout(true /* primary authentication */, [aadStrategyUserPropertyName], req, res, next);
  });
}
