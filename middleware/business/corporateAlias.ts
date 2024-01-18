//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { jsonError } from '..';
import { IProviders, ReposAppRequest } from '../../interfaces';
import { getProviders } from '../../lib/transitional';
import { IndividualContext } from '../../business/user';

const cachedCorporateAliasRequestKey = '__corporateAlias';

export async function getCorporateAliasFromRequest(req: ReposAppRequest): Promise<string> {
  if (req[cachedCorporateAliasRequestKey]) {
    return req[cachedCorporateAliasRequestKey];
  }
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const providers = getProviders(req);
  const corporateAlias = await getCorporateAliasFromActiveContext(providers, activeContext);
  req[cachedCorporateAliasRequestKey] = corporateAlias;
  return corporateAlias;
}

export async function getCorporateAliasFromActiveContext(
  providers: IProviders,
  activeContext: IndividualContext
): Promise<string> {
  const { graphProvider } = providers;
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
