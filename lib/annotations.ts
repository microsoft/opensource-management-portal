//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { getIsCorporateAdministrator } from '../middleware/business/corporateAdministrators.js';
import { CreateError, getProviders } from './transitional.js';
import { IndividualContext } from '../business/user/index.js';
import { ReposAppRequest } from '../interfaces/index.js';

enum OrganizationAnnotationsPrivilege {
  Read = 'read',
  Write = 'write',
}

export async function getCanViewPrivilegedOrganizationAnnotations(req: ReposAppRequest) {
  const isSystemAdministrator = await getIsCorporateAdministrator(req);
  if (isSystemAdministrator) {
    return true;
  }
  return await getIsPrivilegedAnnotationsUser(req, OrganizationAnnotationsPrivilege.Read);
}

export async function getCanWritePrivilegedOrganizationAnnotations(req: ReposAppRequest) {
  const isSystemAdministrator = await getIsCorporateAdministrator(req);
  if (isSystemAdministrator) {
    return true;
  }
  return await getIsPrivilegedAnnotationsUser(req, OrganizationAnnotationsPrivilege.Write);
}

export async function authorizeOnlyPrivilegedOrganizationAnnotationsWriters(
  req: ReposAppRequest,
  res: Response,
  next: NextFunction
) {
  const canWrite = await getCanWritePrivilegedOrganizationAnnotations(req);
  if (canWrite) {
    return next();
  }
  return next(CreateError.NotAuthorized('You do not have permission to write organization annotations'));
}

async function getIsPrivilegedAnnotationsUser(
  req: ReposAppRequest,
  privilege: OrganizationAnnotationsPrivilege
) {
  const { config, graphProvider } = getProviders(req);
  const writersId = config?.github?.annotations?.securityGroups?.writers;
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  const corporateId = activeContext.corporateIdentity?.id;
  // const corporateUsername = activeContext.corporateIdentity?.username;
  if (writersId && graphProvider?.isUserInGroup) {
    const isInGroup = await graphProvider.isUserInGroup(corporateId, writersId);
    if (privilege === OrganizationAnnotationsPrivilege.Write && isInGroup) {
      return true;
    }
    if (privilege === OrganizationAnnotationsPrivilege.Read && isInGroup) {
      return true;
    }
  }
  const readersId = config?.github?.annotations?.securityGroups?.readers;
  if (readersId && graphProvider?.isUserInGroup) {
    const isInGroup = await graphProvider.isUserInGroup(corporateId, readersId);
    if (privilege === OrganizationAnnotationsPrivilege.Read && isInGroup) {
      return true;
    }
  }
  return false;
}
