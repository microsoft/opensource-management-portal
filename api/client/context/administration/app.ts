//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { CreateError } from '../../../../lib/transitional.js';

import GitHubApplication from '../../../../business/application.js';
import routeApplicationInstallation from './appInstallation.js';
import { ApiRequestWithGitHubApplication, RequestWithInstallation } from './types.js';

const router: Router = Router();

router.get('/', async function (req: ApiRequestWithGitHubApplication, res: Response, next: NextFunction) {
  const { gitHubApplication } = req;
  const installationIdString = req.query.installation_id;
  const setupAction = req.query.setup_action;
  // if (installationIdString && setupAction) {
  //   return res.redirect(
  //     `./${githubApplication.id}/installations/${installationIdString}?setup_action=${setupAction}`
  //   );
  // }
  const allInstalls = await gitHubApplication.getInstallations({ maxAgeSeconds: 5 });
  const { valid, invalid } = GitHubApplication.filterInstallations(allInstalls);
  return res.json({
    state: {
      installations: {
        valid,
        invalid,
      },
      app: gitHubApplication.asClientJson(),
    },
  }) as unknown as void;
});

router.use('/installations/:installationId', async function (req: RequestWithInstallation, res, next) {
  const { gitHubApplication } = req;
  const { installationId: installationIdAsString } = req.params;
  const installationId = Number(installationIdAsString);
  const installation = await gitHubApplication.getInstallation(installationId);
  if (!installation) {
    return next(
      CreateError.NotFound(
        `The GitHub app installation ${installationIdAsString} could not be found for app ${gitHubApplication.id}`
      )
    );
  }
  req.installation = installation;
  return next();
});

router.use('/installations/:installationId', routeApplicationInstallation);

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(CreateError.NotFound('no API or function available: context/administration/apps/...'));
});

export default router;
