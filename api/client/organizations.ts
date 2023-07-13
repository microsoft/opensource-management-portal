//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import { jsonError } from '../../middleware';
import { CreateError, getProviders } from '../../transitional';
import { ReposAppRequest } from '../../interfaces';

import RouteOrganization from './organization';
import { apiMiddlewareOrganizationsToOrganization } from '../../middleware/business/organization';
import type { GitHubOrganizationResponseSanitized } from '../../business';
import {
  OrganizationAnnotation,
  OrganizationAnnotationProperty,
  scrubOrganizationAnnotation,
} from '../../entities/organizationAnnotation';
import { getOrganizationProfileViaMemoryCache } from '../../middleware/github/ensureOrganizationProfile';

const router: Router = Router();

type HighlightedOrganization = {
  profile: GitHubOrganizationResponseSanitized;
  annotations: OrganizationAnnotation;
};

router.get(
  '/',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const { operations } = getProviders(req);
    try {
      const orgs = operations.getOrganizations();
      const dd = orgs.map((org) => {
        return org.asClientJson();
      });
      return res.json(dd) as unknown as void;
    } catch (error) {
      throw jsonError(error, 400);
    }
  })
);

router.get(
  '/annotations',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
    const providers = getProviders(req);
    const { organizationAnnotationsProvider } = providers;
    const projection = typeof req.query.projection === 'string' ? req.query.projection : undefined;
    // governance filter: a specific value or unset cohort
    const governance =
      typeof req.query.governance === 'string' ? req.query.governance?.toLowerCase() : undefined;
    const filterByGovernance = governance !== undefined;
    try {
      const highlights: HighlightedOrganization[] = [];
      let annotations = await organizationAnnotationsProvider.getAllAnnotations();
      if (filterByGovernance) {
        annotations = annotations.filter((annotation) => {
          const value = annotation.getProperty(OrganizationAnnotationProperty.Governance);
          return governance ? value === governance : !value;
        });
      }
      for (const annotation of annotations) {
        try {
          const profile = await getOrganizationProfileViaMemoryCache(providers, annotation.organizationId);
          highlights.push({
            profile,
            annotations: scrubOrganizationAnnotation(annotation),
          });
        } catch (error) {
          // we ignore any individual resolution error
        }
      }
      if (projection) {
        let projected = highlights.map((highlight) => {
          const profile = highlight.profile;
          const annotations = highlight.annotations;
          if (profile[projection]) {
            return profile[projection];
          } else if (annotations.getProperty(projection)) {
            return annotations.getProperty(projection);
          } else if (annotations.hasFeature(projection)) {
            return true;
          }
          return null;
        });
        if (projected.length >= 1 && typeof projected[0] === 'string') {
          projected = projected.sort((a, b) => {
            return a.localeCompare(b);
          });
        }
        return res.json(projected) as unknown as void;
      }
      return res.json({
        highlights: highlights.sort((a, b) => {
          return a.profile.login.localeCompare(b.profile.login);
        }),
      }) as unknown as void;
    } catch (error) {
      throw jsonError(error, 400);
    }
  })
);

router.get(
  '/list.txt',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
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

router.use('/:orgName', asyncHandler(apiMiddlewareOrganizationsToOrganization), RouteOrganization);

router.use('*', (req: ReposAppRequest, res: Response, next: NextFunction) => {
  return next(CreateError.NotFound('orgs API not found'));
});

export default router;
