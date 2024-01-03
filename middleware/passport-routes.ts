//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { Response, NextFunction } from 'express';

import { redirectToReferrer, storeReferrer } from '../lib/utils';
import { getProviders } from '../lib/transitional';
import type { ReposAppRequest, IAppSession } from '../interfaces';
import getCompanySpecificDeployment from './companySpecificDeployment';
import { attachAadPassportRoutes } from './passport/aadRoutes';
import { attachGitHubPassportRoutes } from './passport/githubRoutes';

export interface IAuthenticationHelperMethods {
  afterAuthentication: (
    isPrimaryAuthentication: boolean,
    accountPropertyToPromoteToSession: string,
    req: ReposAppRequest,
    res: Response,
    next: NextFunction
  ) => void;
  signout: (
    isPrimaryAuthentication: boolean,
    accountProperties: string[],
    req: ReposAppRequest,
    res: Response,
    next: NextFunction
  ) => void;
  storeReferrer: (req: ReposAppRequest, res: any, redirect: any, optionalReason: any) => void;
}

export interface IPrimaryAuthenticationHelperMethods extends IAuthenticationHelperMethods {
  newSessionAfterAuthentication: (req: ReposAppRequest, res: Response, next: NextFunction) => void;
}

function newSessionAfterAuthentication(req: ReposAppRequest, res: Response, next: NextFunction) {
  // Same site issues
  if (req.query && req.query.failure === 'invalid') {
    const { config } = getProviders(req);
    if (config?.session?.name) {
      try {
        const sessionName = config.session.name;
        res.clearCookie(sessionName);
        return req.session.destroy(() => {
          return res.redirect('/');
        });
      } catch (warnError) {
        console.warn(warnError);
      }
    }
    return res.redirect('/');
  }
  // Prevent session hijacking by generating a new session once authenticated.
  const preserve = Object.assign({}, req.session);
  ['cookie', 'id', 'OIDC', 'req', 'seen'].map((key) => delete preserve[key]);
  const keys = Object.getOwnPropertyNames(preserve);
  for (const key of keys) {
    if (typeof preserve[key] === 'function') {
      delete preserve[key];
    }
  }
  return req.session.regenerate(function (err) {
    if (err) {
      return next(err);
    }
    for (const key in preserve) {
      const value = preserve[key];
      req.session[key] = value;
    }
    return req.session.save(next);
  });
}

export default function configurePassport(app, passport, config) {
  const authenticationHelperMethods: IPrimaryAuthenticationHelperMethods = {
    newSessionAfterAuthentication,
    afterAuthentication,
    signout,
    storeReferrer,
  };

  const companySpecific = getCompanySpecificDeployment();
  companySpecific?.passport?.attach(app, config, passport, authenticationHelperMethods);

  app.get('/signout', signoutPage);
  app.get('/signout/goodbye', signoutPage);

  // The /signin routes are stored inside the AAD passport routes, since the site requires AAD for primary auth today.
  attachAadPassportRoutes(app, config, passport, authenticationHelperMethods);
  attachGitHubPassportRoutes(app, config, passport, authenticationHelperMethods);

  // helper methods follow

  function afterAuthentication(
    isPrimaryAuthentication: boolean,
    accountPropertyToPromoteToSession: string,
    req: ReposAppRequest,
    res: Response,
    next: NextFunction
  ) {
    const after = (req: ReposAppRequest, res: Response) =>
      redirectToReferrer(
        req,
        res,
        '/',
        `${
          isPrimaryAuthentication ? 'primary' : 'secondary'
        } authentication callback with property ${accountPropertyToPromoteToSession}`
      );
    if (!isPrimaryAuthentication) {
      // account is a passport property that we don't expose in ReposAppRequest interface to reduce errors
      return hoistAccountToSession(req, (req as any).account, accountPropertyToPromoteToSession, (error) => {
        return error ? next(error) : after(req, res);
      });
    }

    if ((req.session as any).additionalAuthRedirect) {
      const tmpAdditionalAuthRedirect = (req.session as any).additionalAuthRedirect;
      delete (req.session as any).additionalAuthRedirect;
      return res.redirect(tmpAdditionalAuthRedirect);
    }

    return after(req, res);
  }

  function signout(
    isPrimaryAuthentication: boolean,
    accountProperties: string[],
    req: ReposAppRequest,
    res: Response,
    next: NextFunction
  ) {
    if (isPrimaryAuthentication) {
      return res.redirect('/signout');
    }
    const after = (req, res) => {
      let url = req.headers.referer || '/';
      if (req.query.redirect === 'github') {
        url = 'https://github.com/logout';
      }
      res.redirect(url);
    };
    const secondaryProperties = accountProperties;
    let dirty = false;
    secondaryProperties.forEach((propertyName) => {
      if (req.user && req.user[propertyName] !== undefined) {
        delete req.user[propertyName];
        dirty = true;
      }
    });
    if (dirty) {
      return resaveUser(req, undefined, (error) => {
        return error ? next(error) : after(req, res);
      });
    }
    return after(req, res);
  }

  // User-beware, I should not be writing my own truncating shallow object copy code
  function shallowTruncatingCopy(obj) {
    const o = {};
    for (const entity in obj) {
      const value = obj[entity];
      if (typeof value === 'object') {
        o[entity] = {};
        for (const property in value) {
          if (typeof value[property] !== 'object') {
            o[entity][property] = value[property];
          }
        }
      } else {
        o[entity] = value;
      }
    }
    return o;
  }

  // This function takes an object from the req.account passport store, typically storing
  // a secondary authentication user profile, and places it inside the primary req.user
  // session store, to make it easier to access throughout the application's lifecycle.
  // While the primary authentication type (AAD) does not need to "hoist", this is required
  // for any secondary account types today.
  function hoistAccountToSession(req, account, property, callback) {
    const serializer = req.app._sessionSerializer;
    const entity = account[property];
    if (entity === undefined) {
      return callback(new Error(`No entity available with the property ${property} to be hoisted.`));
    }
    if (serializer === undefined) {
      req.user[property] = entity;
      return callback();
    }
    const clone = shallowTruncatingCopy(req.user);
    clone[property] = entity;
    resaveUser(req, clone, callback);
  }

  // Overwrites the Passport logged in user with a fresh new complete object.
  function resaveUser(req: ReposAppRequest, clone, callback) {
    if (typeof clone === 'function') {
      callback = clone;
      clone = undefined;
    }
    if (clone === undefined) {
      clone = shallowTruncatingCopy(req.user);
    }
    req.login(clone, callback);
  }

  function signoutPage(req: ReposAppRequest, res) {
    const { config, insights } = getProviders(req);
    req.logout({ keepSessionInfo: true }, (err) => {
      if (err) {
        insights?.trackException({ exception: err });
      }
      if (req.session) {
        const session = req.session as IAppSession;
        delete session.enableMultipleAccounts;
        delete session.selectedGithubId;
      }
      if (config.authentication.scheme === 'github') {
        return res.redirect('https://github.com/logout');
      } else {
        const unlinked = req.query.unlink !== undefined;
        return res.render('message', {
          message: unlinked
            ? `Your ${config.brand.companyName} and GitHub accounts have been unlinked. You no longer have access to any ${config.brand.companyName} organizations, and you have been signed out of this portal.`
            : 'Goodbye',
          title: 'Goodbye',
          clearLocalStorage: true,
          buttonText: unlinked ? 'Sign in to connect a new account' : 'Sign in',
          config: config.obfuscatedConfig,
        });
      }
    });
  }
}
