//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ReposAppRequest, IReposError } from '../../interfaces';
import { isEnterpriseManagedUserLogin } from '../../utils';

export function blockEnterpriseManagedUsersAuthentication(req: ReposAppRequest, res, next) {
  const context = req.individualContext;
  if (!context) {
    return next(new Error('Missing context'));
  }
  const sessionIdentity = context.getSessionBasedGitHubIdentity();

  // Underscores are not allowed for GitHub logins and denote an EMU account.
  if (isEnterpriseManagedUserLogin(sessionIdentity?.username)) {
    const securityError: IReposError = new Error(`Enterprise Managed Users are not supported.`);
    securityError.status = 400;
    securityError.detailed = `You've authenticated to this site with a GitHub Enterprise Cloud with Enterprise Managed User (EMU) account, ${sessionIdentity.username}. Please sign out of this site and GitHub and try again from your standard GitHub login for open source use.`;
    securityError.title = 'Enterprise Managed Users are not supported by the Open Source Management Portal';
    securityError.fancyLink = {
      title: 'Sign out of this site and GitHub',
      link: '/signout/github?redirect=github',
    };
    securityError.skipOops = true;
    return next(securityError);
  }

  return next();
}
