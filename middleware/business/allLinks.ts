//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { ReposAppRequest } from '../../interfaces';
import { getProviders } from '../../lib/transitional';
import { wrapError } from '../../lib/utils';

const cachedLinksRequestKeyName = 'cachedLinks';

export async function ensureAllLinksInMemory(req: ReposAppRequest, res: Response, next: NextFunction) {
  if (req[cachedLinksRequestKeyName]) {
    return next();
  }
  const { operations } = getProviders(req);
  try {
    const links = await operations.getLinks();
    req[cachedLinksRequestKeyName] = links;
    return next();
  } catch (linksError) {
    linksError = wrapError(linksError, 'There was a problem retrieving the set of links');
    return next(linksError);
  }
}

export function getAllLinksFromRequest(req: ReposAppRequest) {
  const val = req[cachedLinksRequestKeyName];
  if (!val) {
    throw new Error(
      `No links made available via ${cachedLinksRequestKeyName}, ensureAllLinksInMemory middleware must proceed`
    );
  }
  return val;
}
