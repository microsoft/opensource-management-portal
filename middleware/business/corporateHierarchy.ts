//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { jsonError } from '../index.js';
import { IProviders, ReposAppRequest } from '../../interfaces/index.js';
import { IGraphEntry } from '../../lib/graphProvider/index.js';
import { CreateError, getProviders } from '../../lib/transitional.js';
import { IndividualContext } from '../../business/user/index.js';

const cachedCorporateHierarchyRequestKey = '__corporateTree';

export async function getCorporateHierarchyFromRequest(req: ReposAppRequest): Promise<IGraphEntry[]> {
  if (req[cachedCorporateHierarchyRequestKey]) {
    return req[cachedCorporateHierarchyRequestKey];
  }
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const providers = getProviders(req);
  const managementChain = await getCorporateHierarchyFromActiveContext(providers, activeContext);
  req[cachedCorporateHierarchyRequestKey] = managementChain;
  return managementChain;
}

export async function getCorporateHierarchyFromActiveContext(
  providers: IProviders,
  activeContext: IndividualContext
): Promise<IGraphEntry[]> {
  const { graphProvider } = providers;
  if (!activeContext.corporateIdentity || !activeContext.corporateIdentity.id) {
    throw CreateError.NotAuthenticated('No corporate identity');
  }
  const corporateId = activeContext?.corporateIdentity?.id;
  if (!corporateId) {
    return [];
  }
  let managementChain: IGraphEntry[] = [];
  try {
    managementChain = await graphProvider.getManagementChain(corporateId);
  } catch (error) {
    // there are reasons this may be invalid - service accounts, etc.
  }
  return managementChain;
}
