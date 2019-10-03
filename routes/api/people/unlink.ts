//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { ReposAppRequest } from '../../../transitional';
import { jsonError } from '../../../middleware/jsonError';
import { ICorporateLink } from '../../../business/corporateLink';
import { Operations, UnlinkPurpose } from '../../../business/operations';
import { IApiRequest } from '../../../middleware/apiReposAuth';

const router = express.Router();

interface ILinksApiRequestWithUnlink extends IApiRequest {
  unlink?: ICorporateLink;
}

router.use(function (req: ILinksApiRequestWithUnlink, res, next) {
  const token = req.apiKeyToken;
  if (!token.scopes) {
    return next(jsonError('The key is not authorized for specific APIs', 401));
  }
  if (!token.hasScope('unlink')) {
    return next(jsonError('The key is not authorized to use the unlink API', 401));
  }
  return next();
});

router.use('/github/id/:id', (req: ILinksApiRequestWithUnlink, res, next) => {
  const id = req.params.id;

  const operations = req.app.settings.operations as Operations;
  return operations.linkProvider.getByThirdPartyId(id, (error, link) => {
    if (!link && !error) {
      error = new Error(`Could not locate a link for GitHub user ID ${id}`);
    }
    if (error) {
      return next(jsonError(error));
    }
    req.unlink = link;
    return next();
  });
});

router.use('*', (req: ILinksApiRequestWithUnlink, res, next) => {
  return next(req.unlink ? undefined : jsonError('No link available for operation', 404));
});

router.delete('*', (req: ILinksApiRequestWithUnlink, res, next) => {
  const operations = req.app.settings.operations as Operations;
  const link = req.unlink;
  let purpose: UnlinkPurpose = null;
  try {
    purpose = apiUnlinkPurposeToEnum((req.headers['unlink-purpose'] || 'termination') as string);
  } catch (purposeError) {
    return next(jsonError(purposeError, 400));
  }
  const options = { purpose };
  return operations.terminateLinkAndMemberships(link.thirdPartyId, options).then(results => {
    res.json({
      messages: Array.isArray(results) ? (results as any as string[]).reverse() : results,
    });
  }).catch(problem => {
    return next(jsonError(problem, 500));
  });
});

function apiUnlinkPurposeToEnum(purpose: string): UnlinkPurpose {
  switch (purpose) {
    case 'operations':
      throw new Error('The unlink purpose "operations" is not supported by API');
    case 'termination':
      return UnlinkPurpose.Termination;
    case 'self':
      throw new Error('The unlink purpose "self" is not supported by API');
    default:
      return UnlinkPurpose.Unknown;
  }
}

module.exports = router;
