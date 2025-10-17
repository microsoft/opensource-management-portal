//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { ReposAppRequest, AccountJsonFormat } from '../../interfaces/index.js';
import { CreateError, getProviders } from '../../lib/transitional.js';

const router: Router = Router();

router.get('/:login', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { operations } = getProviders(req);
  const login = req.params.login as string;
  try {
    if (!login) {
      throw CreateError.ParameterRequired('login');
    }
    const accountInfo = await operations.getAccountByUsername(login);
    return res.json(accountInfo.asJson(AccountJsonFormat.GitHubExtended)) as any as void;
  } catch (error) {
    return next(error);
  }
});

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(CreateError.NotFound('/users: no API found'));
});

export default router;
