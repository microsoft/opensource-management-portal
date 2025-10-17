//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { ReposAppRequest, IReposError } from '../../interfaces/index.js';
import { isEnterpriseManagedUserLogin } from '../../lib/utils.js';
import { CreateError, getProviders } from '../../lib/transitional.js';
import getCompanySpecificDeployment from '../companySpecificDeployment.js';

export async function blockEnterpriseManagedUsersAuthentication(
  req: ReposAppRequest,
  res: Response,
  next: NextFunction
) {
  const companySpecific = getCompanySpecificDeployment();
  const { insights } = getProviders(req);
  const context = req.individualContext;
  if (!context) {
    return next(new Error('Missing context'));
  }
  const sessionIdentity = context.getSessionBasedGitHubIdentity();

  // Underscores are not allowed for GitHub logins and denote an EMU account.
  if (isEnterpriseManagedUserLogin(sessionIdentity?.username)) {
    insights?.trackEvent({
      name: 'route.auth.emu_block',
    });
    insights?.trackMetric({
      name: 'route.auth.emu_blocks',
      value: 1,
    });
    const securityError: IReposError = CreateError.NotAuthorized(
      `Enterprise Managed Users are not supported by this portal.`
    );
    securityError.detailed = `You've authenticated to this portal with a GitHub Enterprise Cloud with Enterprise Managed User (EMU) account, ${sessionIdentity.username}. All open source enterprise interactions must use a personal GitHub account and not an EMU account. Please sign out of this site and GitHub and try again from your personal GitHub login to use this site.`;
    securityError.title = 'Enterprise Managed Users are not supported by the Open Source Management Portal';
    securityError.fancyLink = {
      title: 'Sign out of this site and GitHub, then sign in with your personal GitHub account',
      link: '/signout/github?redirect=github',
    };
    securityError.skipOops = true;
    let error = securityError;
    if (companySpecific?.middleware?.authentication?.augmentEmuBlock) {
      error = await companySpecific.middleware.authentication.augmentEmuBlock(
        getProviders(req),
        securityError
      );
    }
    return next(error);
  }

  return next();
}
