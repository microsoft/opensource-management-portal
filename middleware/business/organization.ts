//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { ReposAppRequest } from '../../interfaces/web';
import { jsonError } from '../jsonError';
import { CreateError, ErrorHelper, getProviders } from '../../lib/transitional';
import { setOrganizationProfileForRequest } from '../github/ensureOrganizationProfile';

export enum OrganizationManagementType {
  Managed = 'managed',
  Unmanaged = 'unmanaged',
}

export interface IReposAppRequestWithOrganizationManagementType extends ReposAppRequest {
  organizationManagementType: OrganizationManagementType;
  organizationName: string;
  organizationProfile: any;
}

export function getOrganizationManagementType(req: IReposAppRequestWithOrganizationManagementType) {
  return req.organizationManagementType;
}

export function blockIfUnmanagedOrganization(
  req: IReposAppRequestWithOrganizationManagementType,
  res: Response,
  next: NextFunction
) {
  const managementType = getOrganizationManagementType(req);
  switch (managementType) {
    case OrganizationManagementType.Unmanaged:
      return next(jsonError('unmanaged organization', 404));
    case OrganizationManagementType.Managed:
      return next();
    default:
      return next(jsonError('unknown organization management type', 500));
  }
}

export async function apiMiddlewareOrganizationsToOrganization(
  req: IReposAppRequestWithOrganizationManagementType,
  res: Response,
  next: NextFunction
) {
  const { operations } = getProviders(req);
  const { orgName } = req.params;
  req.organizationName = orgName;
  try {
    const org = operations.getOrganization(orgName);
    if (org) {
      req.organizationManagementType = OrganizationManagementType.Managed;
      req.organization = org;
      return next();
    }
  } catch (orgNotFoundError) {
    if (!ErrorHelper.IsNotFound(orgNotFoundError)) {
      return next(orgNotFoundError);
    }
  }
  try {
    const org = operations.getUncontrolledOrganization(orgName);
    req.organizationManagementType = OrganizationManagementType.Unmanaged;
    req.organization = org;
    await setOrganizationProfileForRequest(req);
  } catch (orgProfileError) {
    if (ErrorHelper.IsNotFound(orgProfileError)) {
      return next(CreateError.NotFound(`The organization ${orgName} does not exist`));
    } else {
      return next(orgProfileError);
    }
  }
  return next();
}
