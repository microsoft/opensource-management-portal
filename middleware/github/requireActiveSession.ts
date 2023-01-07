//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ReposAppRequest } from '../../interfaces';
import { getProviders } from '../../transitional';
import { isCodespacesAuthenticating, storeOriginalUrlAsReferrer } from '../../utils';

export default function RequireActiveGitHubSession(req: ReposAppRequest, res, next) {
  const { config } = getProviders(req);
  const identity = req.individualContext.getSessionBasedGitHubIdentity();
  if (!identity) {
    const signinPath = isCodespacesAuthenticating(config, 'github') ? 'sign-in' : 'signin';
    return storeOriginalUrlAsReferrer(req, res, `/${signinPath}/github`);
  }
  return next();
}
