//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Router } from 'express';
import asyncHandler from 'express-async-handler';

import memoryCache from 'memory-cache';

import { jsonError } from '../../middleware';
import { CreateError, ErrorHelper, getProviders } from '../../transitional';
import { ReposAppRequest } from '../../interfaces';

import RouteOrganization from './organization';
import {
  IReposAppRequestWithOrganizationManagementType,
  OrganizationManagementType,
} from '../../middleware/business/organization';

import { IGitHubOrganizationResponse } from '../../business';
import { OrganizationAnnotation } from '../../entities/organizationAnnotation';

const router: Router = Router();

type HighlightedOrganization = {
  profile: IGitHubOrganizationResponse;
  annotations: OrganizationAnnotation;
};

router.get(
  '/',
  asyncHandler(async (req: ReposAppRequest, res, next) => {
    const { operations } = getProviders(req);
    try {
      const orgs = operations.getOrganizations();
      const dd = orgs.map((org) => {
        return org.asClientJson();
      });
      return res.json(dd);
    } catch (error) {
      throw jsonError(error, 400);
    }
  })
);

router.get(
  '/annotations',
  asyncHandler(async (req: ReposAppRequest, res, next) => {
    const { operations, organizationAnnotationsProvider } = getProviders(req);
    const cacheTimeMs = 1000 * 60 * 60 * 24;
    try {
      const highlights: HighlightedOrganization[] = [];
      const annotations = await organizationAnnotationsProvider.getAllAnnotations();
      for (const annotation of annotations) {
        try {
          const key = `org:profile:${annotation.organizationId}`;
          let profile = memoryCache.get(key) as IGitHubOrganizationResponse;
          if (!profile) {
            const details = await operations.getOrganizationProfileById(Number(annotation.organizationId));
            details.cost && delete details.cost;
            details.headers && delete details.headers;
            profile = details;
            memoryCache.put(key, details, cacheTimeMs);
          }
          const scrubbedAnnotations = { ...annotation };
          delete scrubbedAnnotations.administratorNotes;
          delete scrubbedAnnotations.history;
          highlights.push({
            profile,
            annotations: scrubbedAnnotations as OrganizationAnnotation,
          });
        } catch (error) {
          // we ignore any individual resolution error
        }
      }
      return res.json({
        highlights: highlights.sort((a, b) => {
          return a.profile.login.localeCompare(b.profile.login);
        }),
      });
    } catch (error) {
      throw jsonError(error, 400);
    }
  })
);

router.get(
  '/list.txt',
  asyncHandler(async (req: ReposAppRequest, res, next) => {
    const { operations } = getProviders(req);
    try {
      const orgs = operations.getOrganizations();
      const dd = orgs.map((org) => {
        return org.name.toLowerCase();
      });
      res.contentType('text/txt');
      res.send(dd.sort().join('\n'));
    } catch (error) {
      throw jsonError(error, 400);
    }
  })
);

router.use(
  '/:orgName',
  asyncHandler(async (req: IReposAppRequestWithOrganizationManagementType, res, next) => {
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
      const details = await org.getDetails();
      details.cost && delete details.cost;
      details.headers && delete details.headers;
      req.organizationProfile = details;
    } catch (orgProfileError) {
      if (ErrorHelper.IsNotFound(orgProfileError)) {
        return next(CreateError.NotFound(`The organization ${orgName} does not exist`));
      } else {
        return next(orgProfileError);
      }
    }
    req.organizationManagementType = OrganizationManagementType.Unmanaged;
    return next();
  })
);

router.use('/:orgName', RouteOrganization);

router.use('*', (req: ReposAppRequest, res, next) => {
  return next(jsonError('orgs API not found', 404));
});

export default router;
