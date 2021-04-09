//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { jsonError } from '..';
import { ReposAppRequest } from '../../interfaces';
import { getProviders } from '../../transitional';
import { IndividualContext } from '../../user';

export default async function getCorporateAliasFromActiveContext(req: ReposAppRequest) {
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const { graphProvider } = getProviders(req);
  if (!activeContext.corporateIdentity || !activeContext.corporateIdentity.id) {
    throw jsonError('No corporate identity', 401);
  }
  let corporateAlias = activeContext?.link?.corporateAlias;
  if (!corporateAlias) {
    const id = activeContext.corporateIdentity.id;
    const entry = await graphProvider.getUserById(id);
    if (!entry || !entry.mailNickname) {
      throw jsonError('Invalid corporate identity', 401);
    }
    corporateAlias = entry.mailNickname;
  }
  return corporateAlias;
}
