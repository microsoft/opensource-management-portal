//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Response, NextFunction } from 'express';

import { ReposAppRequest, IAppSession, ReposAppUser, ReposApiRequest } from '../../interfaces/index.js';

import Debug from 'debug';
const debug = Debug.debug('user');

import { CreateError, getProviders } from '../../lib/transitional.js';
import {
  ICorporateIdentity,
  IGitHubIdentity,
  IndividualContext,
  GitHubIdentitySource,
} from '../../business/user/index.js';
import { storeOriginalUrlAsReferrer } from '../../lib/utils.js';
import getCompanySpecificDeployment from '../companySpecificDeployment.js';

export async function requireAuthenticatedUserOrSignInExcluding(
  exclusionPaths: string[],
  req: ReposAppRequest,
  res: Response,
  next: NextFunction
) {
  const url = req.url;
  for (let i = 0; i < exclusionPaths.length; i++) {
    if (url.startsWith(exclusionPaths[i])) {
      console.log(`${req.method} ${req.baseUrl} excluded from auth by prefix: ${exclusionPaths[i]}`);
      return next();
    }
  }
  return await requireAuthenticatedUserOrSignIn(req, res, next);
}

export async function requireAccessTokenClient(req: ReposAppRequest, res: Response, next: NextFunction) {
  if (req.oauthAccessToken) {
    return next();
  }
  // This code currently assumes you're using AAD.
  const { authorizationCodeClient } = getProviders(req);
  if (!req.user.azure) {
    console.warn('Not an Azure authenticated user');
    return signoutThenSignIn(req, res);
  }
  // Build an OAuth Access Token instance for the request, refreshing as needed
  const { oauthToken } = req.user.azure;
  if (authorizationCodeClient && oauthToken) {
    const hydratedToken = JSON.parse(oauthToken);
    let oauthTokenInstance = authorizationCodeClient.createToken(hydratedToken);
    if (oauthTokenInstance.expired()) {
      oauthTokenInstance = await oauthTokenInstance.refresh();
      const session = req.session as IAppSession;
      session.passport.user.azure.oauthToken = JSON.stringify(oauthTokenInstance.token);
    }
    req.oauthAccessToken = oauthTokenInstance;
  } else {
    // this is only used during the transition to storing this kind of data
    // console.warn('The user did not have an oauthToken available');
    // return signoutThenSignIn(req, res);
  }
  return next();
}

function signoutThenSignIn(req: ReposAppRequest, res: Response) {
  const { insights } = getProviders(req);
  req.logout({ keepSessionInfo: false }, (err) => {
    if (err) {
      insights?.trackException({ exception: err });
    }
    return redirectToSignIn(req, res);
  });
}

function redirectToSignIn(req: ReposAppRequest, res: Response) {
  const config = getProviders(req).config;
  storeOriginalUrlAsReferrer(
    req,
    res,
    `/auth/${config.authentication.scheme === 'aad' ? 'azure' : config.authentication.scheme}`,
    'user is not authenticated and needs to authenticate'
  );
}

export async function requireAuthenticatedUserOrSignIn(
  req: ReposAppRequest,
  res: Response,
  next: NextFunction
) {
  const companySpecific = getCompanySpecificDeployment();
  const providers = getProviders(req);
  const { config } = providers;
  if (req.isAuthenticated()) {
    const expectedAuthenticationProperty = config.authentication.scheme === 'github' ? 'github' : 'azure';
    if (req.user && !req.user[expectedAuthenticationProperty]) {
      console.warn(
        `A user session was authenticated but did not have present the property "${expectedAuthenticationProperty}" expected for this type of authentication. Signing them out.`
      );
      return res.redirect('/signout');
    }
    const expectedAuthenticationKey = config.authentication.scheme === 'github' ? 'id' : 'oid';
    if (!req.user[expectedAuthenticationProperty][expectedAuthenticationKey]) {
      return next(new Error('Invalid information present for the authentication provider.'));
    }
    // Require a last-known authenticated date or they need to sign in again
    const userAsAny = req.user as any;
    if (!userAsAny.lastAuthenticated) {
      return req.logout({ keepSessionInfo: false }, (err) => {
        if (err) {
          return next(err);
        }
        return res.redirect('/signin');
      });
    }
    return next();
  }
  let shouldRedirectToSignIn = true;
  if (companySpecific?.middleware?.authentication?.shouldRedirectToSignIn) {
    shouldRedirectToSignIn = await companySpecific.middleware.authentication.shouldRedirectToSignIn(
      providers,
      req
    );
  }
  return shouldRedirectToSignIn ? redirectToSignIn(req, res) : next();
}

export async function requireAuthenticatedUserOrFail(
  req: ReposAppRequest,
  res: Response,
  next: NextFunction
) {
  const providers = getProviders(req);
  const { config } = providers;
  if (req.isAuthenticated()) {
    const expectedAuthenticationProperty = config.authentication.scheme === 'github' ? 'github' : 'azure';
    if (req.user && !req.user[expectedAuthenticationProperty]) {
      console.warn(
        `A user session was authenticated but did not have present the property "${expectedAuthenticationProperty}" expected for this type of authentication. Signing them out.`
      );
      return res.redirect('/signout');
    }
    const expectedAuthenticationKey = config.authentication.scheme === 'github' ? 'id' : 'oid';
    if (!req.user[expectedAuthenticationProperty][expectedAuthenticationKey]) {
      return next(new Error('Invalid information present for the authentication provider.'));
    }
    // Require a last-known authenticated date or they need to sign in again
    const userAsAny = req.user as any;
    if (!userAsAny.lastAuthenticated) {
      return req.logout({ keepSessionInfo: false }, (err) => {
        if (err) {
          return next(err);
        }
        return next(CreateError.NotAuthenticated('User is not authenticated'));
      });
    }
    return next();
  }
  return next(CreateError.NotAuthenticated('User is not authenticated'));
}

export async function setIdentity(req: ReposAppRequest, res: Response, next: NextFunction) {
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  if (!activeContext) {
    return next(new Error('No context available'));
  }
  const contextName = req.individualContext ? 'Individual User Context' : 'API Context';

  let requestForAuthentication = req;
  let sourceText = 'AUTHENTICATED SESSION';

  let user: ReposAppUser;
  const overwrittenUserSource = req.userOverwriteRequest;
  if (overwrittenUserSource) {
    user = overwrittenUserSource;
    console.warn('overwrittenUserSource: *SUBSTITUTING* session identity with another source of user info');
  } else {
    const overwrittenRequestSource = req['userContextOverwriteRequest'];
    if (overwrittenRequestSource) {
      console.warn(
        'userContextOverwriteRequest: *SUBSTITUTING* session identity with another source of data'
      );
      console.dir(overwrittenRequestSource);
      requestForAuthentication = overwrittenRequestSource;
      sourceText = 'OVERWRITTEN SOURCE OF TRUTH';
    }
    user = requestForAuthentication.user;
  }

  let corporateIdentity: ICorporateIdentity = null;
  let gitHubIdentity: IGitHubIdentity = null;

  let s = `${contextName} ${sourceText}: `;

  if (user.github) {
    s += `github(id=${user.github.id}, username=${user.github.username}) `;
    gitHubIdentity = {
      id: user.github.id,
      username: user.github.username,
      displayName: user.github.displayName,
      avatar: user.github.avatarUrl,
      source: GitHubIdentitySource.Session,
    };
  }
  if (user.azure) {
    s += `azure(oid=${user.azure.oid}, username=${user.azure.username}) `;
    corporateIdentity = {
      id: user.azure.oid,
      username: user.azure.username,
      displayName: user.azure.displayName,
    };
  }
  debug(s);

  activeContext.corporateIdentity = corporateIdentity;
  activeContext.setSessionBasedGitHubIdentity(gitHubIdentity);

  if (!corporateIdentity) {
    return next(new Error('Not a valid corporate user'));
  }

  return next();
}
