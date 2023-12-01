//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';
import querystring from 'querystring';

import { ReposAppRequest } from '../../interfaces';
import { getProviders } from '../../transitional';
import { isCodespacesAuthenticating } from '../../utils';
import { IAuthenticationHelperMethods } from '../passport-routes';
import {
  getGithubAppConfigurationOptions,
  githubStrategyName,
  githubIncreasedScopeStrategyName,
  githubStrategyUserPropertyName,
  githubIncreasedScopeStrategyUserPropertyName,
} from '../passport/githubStrategy';

export function attachGitHubPassportRoutes(
  app,
  config: any,
  passport,
  helpers: IAuthenticationHelperMethods
) {
  const signinPath = isCodespacesAuthenticating(config, 'github') ? 'sign-in' : 'signin';
  app.get(`/${signinPath}/github`, function (req: ReposAppRequest, res: Response) {
    helpers.storeReferrer(req, res, '/auth/github', `/${signinPath}/github authentication page requested`);
  });

  app.get('/auth/github', passport.authorize(githubStrategyName));

  const githubFailureRoute = { failureRedirect: '/auth/github/' };
  app.get(
    '/auth/github/callback',
    passport.authorize(githubStrategyName, githubFailureRoute),
    (req: ReposAppRequest, res: Response, next: NextFunction) => {
      return helpers.afterAuthentication(
        false /* not primary auth */,
        githubStrategyUserPropertyName,
        req,
        res,
        next
      );
    }
  );

  app.get('/signout/github', (req: ReposAppRequest, res: Response, next: NextFunction) => {
    helpers.signout(
      false /* not primary authentication */,
      [githubStrategyUserPropertyName, githubIncreasedScopeStrategyUserPropertyName],
      req,
      res,
      next
    );
  });

  // ====================
  // expanded scope auth:
  // ====================
  // the OAuth legacy generation of the app supported allowing users to one-click join
  // by writing their own membership to an invitation; the code still works, but is not
  // used in the same way when using modern GitHub Apps. For the time, this code remains,
  // but most users today will not interact with these routes.

  function blockIncreasedScopeForModernApps(req: ReposAppRequest, res: Response, next: NextFunction) {
    const { modernAppInUse } = getGithubAppConfigurationOptions(config);
    if (modernAppInUse) {
      return next(
        new Error(
          'This site is using the newer GitHub App model and so the increased-scope routes are no longer applicable to it'
        )
      );
    }
    return next();
  }

  app.get(
    `/${signinPath}/github/increased-scope`,
    blockIncreasedScopeForModernApps,
    function (req: ReposAppRequest, res: Response) {
      helpers.storeReferrer(
        req,
        res,
        '/auth/github/increased-scope',
        `request for the /${signinPath}/github/increased-scope page to go auth with more GitHub scope`
      );
    }
  );

  app.get(
    '/auth/github/increased-scope',
    blockIncreasedScopeForModernApps,
    passport.authorize(githubIncreasedScopeStrategyName)
  );

  const githubIncreasedScopeFailureRoute = { failureRedirect: '/auth/github/increased-scope' };
  app.get(
    '/auth/github/callback/increased-scope',
    blockIncreasedScopeForModernApps,
    passport.authorize(githubIncreasedScopeStrategyName, githubIncreasedScopeFailureRoute),
    (req: ReposAppRequest, res: Response, next: NextFunction) => {
      // used to be: authenticationCallback.bind(null, 'all', 'githubIncreasedScope'));
      return helpers.afterAuthentication(
        false /* not primary */,
        githubIncreasedScopeStrategyUserPropertyName,
        req,
        res,
        next
      );
    }
  );

  // ============
  // legacy join:
  // ============
  // GitHub once supported users creating a brand new account during an initial auth
  // request. I believe that this no longer works, since perhaps 2018; however, this
  // used to work, and will not negatively impact the app at this time. Should revisit. -jw 2021
  app.get(`/${signinPath}/github/join`, (req, res) => {
    res.render('creategithubaccount', {
      title: 'Create a GitHub account',
      user: req.user,
      config: config.obfuscatedConfig,
    });
  });

  app.get('/auth/github/join', (req: ReposAppRequest, res) => {
    const { config } = getProviders(req);
    const authorizeRelativeUrl = req.app.settings['runtime/passport/github/authorizeUrl'].replace(
      'https://github.com',
      ''
    );
    const joinUrl =
      'https://github.com/join?' +
      querystring.stringify({
        return_to:
          `${authorizeRelativeUrl}?` +
          querystring.stringify({
            client_id: config.github.oauth2.clientId,
            redirect_uri: config.github.oauth2.callbackUrl,
            response_type: 'code',
            scope: req.app.settings['runtime/passport/github/scope'],
          }),
        source: 'oauth',
      });
    res.redirect(joinUrl);
  });
}
