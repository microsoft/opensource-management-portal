//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import asyncHandler from 'express-async-handler';
import memoryCache from 'memory-cache';
import { NextFunction, Response } from 'express';

import type { IReposAppRequestWithOrganizationManagementType } from '../business/organization';
import { CreateError, getProviders } from '../../lib/transitional';
import {
  getOrganizationDetailsSanitized,
  type GitHubOrganizationResponseSanitized,
} from '../../business/organization';
import type { IProviders } from '../../interfaces';

export async function setOrganizationProfileForRequest(req: IReposAppRequestWithOrganizationManagementType) {
  const providers = getProviders(req);
  const org = req.organization;
  if (!org) {
    throw CreateError.InvalidParameters('No organization instance available in the request');
  }
  if (!req.organizationProfile && org?.id) {
    req.organizationProfile = await getOrganizationProfileViaMemoryCache(providers, String(org.id));
  }
  if (!req.organizationProfile && org) {
    req.organizationProfile = getOrganizationDetailsSanitized(await org.getDetails());
  }
}

export async function getOrganizationProfileViaMemoryCache(providers: IProviders, organizationId: string) {
  const { operations } = providers;
  const cacheTimeMs = 1000 * 60 * 60 * 24;

  const key = `org:profile:${organizationId}`;
  let profile = memoryCache.get(key) as GitHubOrganizationResponseSanitized;
  if (!profile) {
    const details = getOrganizationDetailsSanitized(
      await operations.getOrganizationProfileById(Number(organizationId))
    );
    profile = details;
    memoryCache.put(key, details, cacheTimeMs);
  }
  return profile;
}

async function ensureOrganizationProfile(
  req: IReposAppRequestWithOrganizationManagementType,
  res: Response,
  next: NextFunction
) {
  await setOrganizationProfileForRequest(req);
  return next();
}

export const ensureOrganizationProfileMiddleware = asyncHandler(ensureOrganizationProfile);
