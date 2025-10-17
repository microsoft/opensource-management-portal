//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';
import { PassportStatic } from 'passport';

import { isCodespacesAuthenticating } from '../../../lib/utils.js';

import type { IReposApplication, ReposAppRequest, SiteConfiguration } from '../../../interfaces/index.js';
import type { IPrimaryAuthenticationHelperMethods } from '../../passport-routes.js';
import { CreateError, ErrorHelper } from '../../../lib/transitional.js';

const entraStrategyId = 'entra-id';
export const entraStrategyUserPropertyName = 'azure';

export function attachEntraPassportRoutes(
  app: IReposApplication,
  config: SiteConfiguration,
  passport: PassportStatic,
  helpers: IPrimaryAuthenticationHelperMethods
) {
  const signinPath = isCodespacesAuthenticating(config, entraStrategyId) ? 'sign-in' : 'signin';
  // takes over primary app auth only if that type...
  if (config.authentication.scheme === entraStrategyId) {
    app.get(`/${signinPath}`, function (req: ReposAppRequest, res: Response, next: NextFunction) {
      if (req.isAuthenticated()) {
        const username = req.user?.azure?.username;
        if (username) {
          // Do not sign in yet again
          const nextDestination = req.headers?.referer || '/';
          return res.redirect(nextDestination);
        }
      }
      return helpers.storeReferrer(req, res, '/auth/entra-id', 'signin page hit, need to go authenticate');
    });
  }

  // SameSite cookie auth fixes, will regenerate even more sessions before proceeding to redirect to AAD...
  const authRoute = (req: ReposAppRequest, res: Response, next: NextFunction) => {
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
    }) as unknown as void;
  };

  app.get('/auth/entra-id', authRoute);

  if (config.authentication.scheme === entraStrategyId) {
    app.get('/auth', authRoute);
  }

  app.get(
    '/auth/entra-id',
    passport.authenticate(entraStrategyId, {
      keepSessionInfo: true /* we manually regenerate for XSS */,
    })
  );

  app.get(
    '/auth/entra-id/callback',
    (req: ReposAppRequest, res: Response, next: NextFunction) => {
      return passport.authenticate(
        entraStrategyId,
        { failWithError: true },
        (
          err: any,
          user?: Express.User | false | null,
          info?: object | string | Array<string | undefined>,
          status?: number | Array<number | undefined>
        ) => {
          if (err) {
            return next(err);
          }
          const infoMessage = (info as any)?.message as string;
          if (status === 401) {
            return next(CreateError.NotAuthenticated(infoMessage || 'Not authenticated'));
          } else if (status === 403) {
            return next(CreateError.NotAuthenticated(infoMessage || 'Not authorized'));
          } else if (!user) {
            const error = CreateError.NotAuthorized('No user information was provided');
            ErrorHelper.EnsureHasStatus(error, status as number);
            return next(error);
          }
          const preserveSessionOptions = {
            keepSessionInfo: true,
          } as any;
          return req.login(user, preserveSessionOptions, next);
        }
      )(req, res, next);
    },
    helpers.newSessionAfterAuthentication,
    (req: ReposAppRequest, res: Response, next: NextFunction) => {
      helpers.afterAuthentication(
        true /* primary app authentication */,
        entraStrategyUserPropertyName,
        req,
        res,
        next
      );
    }
  );

  // identical to top due to not really being primary
  app.get(`/${signinPath}/entra-id`, function (req: ReposAppRequest, res: Response) {
    helpers.storeReferrer(
      req,
      res,
      '/auth/entra-id',
      `request for the /${signinPath}/entra-id page, need to authenticate`
    );
  });

  app.get('/signout/entra-id', (req: ReposAppRequest, res: Response, next: NextFunction) => {
    return helpers.signout(
      true /* primary authentication */,
      [entraStrategyUserPropertyName],
      req,
      res,
      next
    );
  });
}
