//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ReposAppRequest } from '../../interfaces/web';
import { jsonError } from '../jsonError';

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

export function blockIfUnmanagedOrganization(req: IReposAppRequestWithOrganizationManagementType, res, next) {
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
