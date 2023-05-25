//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { jsonError } from '..';
import { IProviders, ReposAppRequest } from '../../interfaces';
import { getProviders } from '../../transitional';
import { IndividualContext } from '../../business/user';

const cachedCorporateMailRequestKey = '__corporateMail';

export async function getCorporateMailFromRequest(req: ReposAppRequest): Promise<string> {
  if (req[cachedCorporateMailRequestKey]) {
    return req[cachedCorporateMailRequestKey];
  }
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const providers = getProviders(req);
  const corporateAlias = await getCorporateMailFromActiveContext(providers, activeContext);
  req[cachedCorporateMailRequestKey] = corporateAlias;
  return corporateAlias;
}

export async function getCorporateMailFromActiveContext(
  providers: IProviders,
  activeContext: IndividualContext
): Promise<string> {
  const { graphProvider } = providers;
  if (!activeContext.corporateIdentity || !activeContext.corporateIdentity.id) {
    throw jsonError('No corporate identity', 401);
  }
  let corporateMail = activeContext?.link?.corporateMailAddress;
  if (!corporateMail) {
    const id = activeContext.corporateIdentity.id;
    const entry = await graphProvider.getUserById(id);
    if (!entry || !entry.mailNickname) {
      throw jsonError('Invalid corporate identity', 401);
    }
    corporateMail = entry.mail;
  }
  return corporateMail;
}
