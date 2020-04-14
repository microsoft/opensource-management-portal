//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ReposAppRequest } from '../../transitional';
import { wrapError } from '../../utils';
import { Operations } from '../../business/operations';

const cachedLinksRequestKeyName = 'cachedLinks';

export async function ensureAllLinksInMemory(req: ReposAppRequest, res, next) {
  if (req[cachedLinksRequestKeyName]) {
    return next();
  }
  const operations = req.app.settings.operations as Operations;
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
    throw new Error(`No links made available via ${cachedLinksRequestKeyName}, ensureAllLinksInMemory middleware must proceed`);
  }
  return val;
}
