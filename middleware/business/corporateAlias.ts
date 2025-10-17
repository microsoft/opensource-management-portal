//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { jsonError } from '../index.js';
import { IProviders, ReposAppRequest } from '../../interfaces/index.js';
import { CreateError, getProviders } from '../../lib/transitional.js';
import { IndividualContext } from '../../business/user/index.js';

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
    throw CreateError.NotAuthenticated('No corporate identity');
  }
  let corporateAlias = activeContext?.link?.corporateAlias;
  if (!corporateAlias) {
    const id = activeContext.corporateIdentity.id;
    const entry = await graphProvider.getUserById(id);
    if (!entry || !entry.mailNickname) {
      throw CreateError.InvalidParameters('Invalid corporate identity (no alias or mailNickname)');
    }
    corporateAlias = entry.mailNickname;
  }
  return corporateAlias;
}
