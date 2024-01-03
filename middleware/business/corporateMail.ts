//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { jsonError } from '..';
import { IProviders, ReposAppRequest } from '../../interfaces';
import { ErrorHelper, getProviders } from '../../lib/transitional';
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
  if (!activeContext.corporateIdentity || !activeContext.corporateIdentity.id) {
    throw jsonError('No corporate identity', 401);
  }
  let corporateMail = activeContext?.link?.corporateMailAddress;
  if (!corporateMail) {
    const mail = await tryGetCorporateMailFromId(providers, activeContext.corporateIdentity.id);
    if (!mail) {
      throw jsonError('Invalid corporate identity', 401);
    }
    corporateMail = mail;
  }
  return corporateMail;
}

export async function tryGetCorporateMailFromId(providers: IProviders, corporateId: string): Promise<string> {
  const { graphProvider } = providers;
  try {
    const info = await graphProvider.getUserById(corporateId);
    if (info?.mail) {
      return info.mail;
    }
  } catch (error) {
    if (!ErrorHelper.IsNotFound(error)) {
      throw error;
    }
  }
  return null;
}
