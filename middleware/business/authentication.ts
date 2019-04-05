//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

const _ = require('lodash');

import { ReposAppRequest } from '../../transitional';
import { ICorporateIdentity, IGitHubIdentity, IndividualContext, GitHubIdentitySource } from '../../business/context2';
import { storeOriginalUrlAsReferrer } from '../../utils';

export function requireAuthenticatedUserOrSignIn(req: ReposAppRequest, res, next) {
  const config = req.app.settings.runtimeConfig;
  if (req.isAuthenticated()) {
    const expectedAuthenticationProperty = config.authentication.scheme === 'github' ? 'github' : 'azure';
    if (req.user && !req.user[expectedAuthenticationProperty]) {
      console.warn(`A user session was authenticated but did not have present the property "${expectedAuthenticationProperty}" expected for this type of authentication. Signing them out.`);
      return res.redirect('/signout');
    }
    const expectedAuthenticationKey = config.authentication.scheme === 'github' ? 'id' : 'oid';
    if (!req.user[expectedAuthenticationProperty][expectedAuthenticationKey]) {
      return next(new Error('Invalid information present for the authentication provider.'));
    }
    return next();
  }
  storeOriginalUrlAsReferrer(req, res, config.authentication.scheme === 'github' ? '/auth/github' : '/auth/azure', 'user is not authenticated and needs to authenticate');
}

export function setIdentity(req: ReposAppRequest, res, next) {
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  if (!activeContext) {
    return next(new Error('No context available'));
  }
  const contextName = req.individualContext ? 'Individual User Context' : 'API Context';

  let requestForAuthentication = req;
  let sourceText = 'AUTHENTICATED SESSION';

  const overwrittenRequestSource = req['userContextOverwriteRequest'];
  if (overwrittenRequestSource) {
    console.warn('userContextOverwriteRequest: *SUBSTITUTING* session identity with another source of data');
    console.dir(overwrittenRequestSource);
    requestForAuthentication = overwrittenRequestSource;
    sourceText = 'OVERWRITTEN SOURCE OF TRUTH';
  }

  let corporateIdentity: ICorporateIdentity = null;
  let gitHubIdentity: IGitHubIdentity = null;
  // temp
  let s = `${contextName} ${sourceText}: `;
  const user = requestForAuthentication.user;

  console.log();
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
  console.log(s);
  // end temp

  // const insights = req.app.settings.providers.insights;

  activeContext.corporateIdentity = corporateIdentity;
  activeContext.setSessionBasedGitHubIdentity(gitHubIdentity);

  if (activeContext.webContext) {
    activeContext.webContext.pushBreadcrumb('Organizations');
  }

  if (!corporateIdentity) {
    // JUST TESTING:
    // TODO: when and where does this happen?
    return next(new Error('Not a valid corporate user'));
  }

  return next();
}
