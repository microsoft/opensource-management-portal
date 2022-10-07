//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Router } from 'express';

import { jsonError } from '../../middleware/jsonError';
import { IAppSession, ReposAppRequest } from '../../interfaces';
import { getProviders } from '../../transitional';

const router: Router = Router();

// This route is /api/client/signout*

router.post('/', (req: ReposAppRequest, res) => {
  const { insights } = getProviders(req);
  // For client apps, we keep the session active to allow
  // for a few feature flags to be present.
  req.logout({ keepSessionInfo: true }, (err) => {
    const session = req.session as IAppSession;
    if (session) {
      delete session.enableMultipleAccounts;
      delete session.selectedGithubId;
    }
    if (err) {
      insights?.trackException({ exception: err });
      res.status(500);
    } else {
      res.status(204);
    }
    res.end();
  });
});

router.post('/github', (req: ReposAppRequest, res) => {
  const session = req.session as IAppSession;
  if (session?.passport?.user?.github) {
    delete session.passport.user.github;
  }
  res.status(204);
  res.end();
});

router.use('*', (req: ReposAppRequest, res, next) => {
  return next(jsonError('API or route not found', 404));
});

export default router;
