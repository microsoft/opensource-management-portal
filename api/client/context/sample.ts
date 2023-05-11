//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Router } from 'express';
import asyncHandler from 'express-async-handler';

import { sendLinkedAccountMail } from '../../../business/operations/link';
import { ReposAppRequest } from '../../../interfaces';
import { jsonError } from '../../../middleware';
import { CreateError, getProviders } from '../../../transitional';
import { IndividualContext } from '../../../business/user';

const router: Router = Router();

router.get(
  '/:templateName',
  asyncHandler(async (req: ReposAppRequest, res, next) => {
    const { operations } = getProviders(req);
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    const templateName = req.params.templateName as string;
    try {
      switch (templateName) {
        case 'link': {
          await sendLinkedAccountMail(
            operations,
            activeContext.link,
            activeContext.link.corporateMailAddress || activeContext.corporateIdentity?.username,
            'sample',
            true
          );
          break;
        }
        default: {
          throw CreateError.InvalidParameters(`The template name ${templateName} is not supported`);
        }
      }
    } catch (error) {
      return next(error);
    }
    return res.json({ templateName });
  })
);

router.use('*', (req: ReposAppRequest, res, next) => {
  return next(jsonError('Contextual API or route not found within samples', 404));
});

export default router;
