//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { jsonError } from '../index.js';
import { IProviders, ReposAppRequest } from '../../interfaces/index.js';
import { CreateError, ErrorHelper, getProviders } from '../../lib/transitional.js';
import { IndividualContext } from '../../business/user/index.js';

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
    throw CreateError.NotAuthenticated('No corporate identity');
  }
  let corporateMail = activeContext?.link?.corporateMailAddress;
  if (!corporateMail) {
    const mail = await tryGetCorporateMailFromId(providers, activeContext.corporateIdentity.id);
    if (!mail) {
      throw CreateError.InvalidParameters('Invalid corporate identity (no mail assigned)');
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
