//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';
import throat from 'throat';

import { getIsCorporateAdministrator, jsonError } from '../../middleware';
import { CreateError, getProviders } from '../../lib/transitional';
import { ReposAppRequest } from '../../interfaces';

import RouteOrganization from './organization';
import { apiMiddlewareOrganizationsToOrganization } from '../../middleware/business/organization';
import type { GitHubOrganizationResponseSanitized } from '../../business';
import {
  OrganizationAnnotation,
  OrganizationAnnotationProperty,
  getOrganizationAnnotationRestrictedPropertyNames,
} from '../../business/entities/organizationAnnotation';
import { getOrganizationProfileViaMemoryCache } from '../../middleware/github/ensureOrganizationProfile';

const router: Router = Router();

export type OrganizationAnnotationPair = {
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
    const projectionQuery = typeof req.query.projection === 'string' ? req.query.projection : undefined;
    const isSystemAdministrator = await getIsCorporateAdministrator(req);
    // governance filter: a specific value or unset cohort
    const governance =
      typeof req.query.governance === 'string' ? req.query.governance?.toLowerCase() : undefined;
    const filterByGovernance = governance !== undefined;
    try {
      const highlights: OrganizationAnnotationPair[] = [];
      let annotations = await organizationAnnotationsProvider.getAllAnnotations();
      if (filterByGovernance) {
        annotations = annotations.filter((annotation) => {
          const value = annotation?.getProperty(OrganizationAnnotationProperty.Governance);
          return governance ? value === governance : !value;
        });
      }
      const getAnnotationProfile = async (annotation: OrganizationAnnotation) => {
        try {
          const profile = await getOrganizationProfileViaMemoryCache(providers, annotation.organizationId);
          highlights.push({
            profile,
            annotations: annotation,
          });
        } catch (error) {
          // we ignore any individual resolution error
        }
      };
      const projections = projectionQuery?.split(',');
      if (projections?.length > 0) {
        const propertiesToRedact = getOrganizationAnnotationRestrictedPropertyNames(isSystemAdministrator);
        if (projections.some((p) => propertiesToRedact.includes(p))) {
          throw CreateError.InvalidParameters(
            `One or more of the requested projections are not authorized for the current user`
          );
        }
      }
      const parallelRequests = 6;
      const throttle = throat(parallelRequests);
      await Promise.all(annotations.map((annotation) => throttle(() => getAnnotationProfile(annotation))));
      if (projectionQuery) {
        if (projections.length > 1 && !projections.includes('login')) {
          throw CreateError.InvalidParameters('When using multiple projections, login must be included');
        }
        let projected = highlights.map((highlight) => {
          const profile = highlight.profile;
          const annotations = highlight.annotations;
          const result = {};
          for (const p of projections) {
            let value = null;
            if (profile[p]) {
              value = result[p] = profile[p];
            } else if (annotations?.getProperty(p)) {
              value = result[p] = annotations.getProperty(p);
            } else if (annotations?.hasFeature(p)) {
              value = result[p] = true;
            }
            if (projections.length === 1) {
              return value;
            }
          }
          return result;
        });
        if (projections.length === 1 && projected.length >= 1 && typeof projected[0] === 'string') {
          projected = projected.sort((a, b) => {
            return a.localeCompare(b);
          });
        } else if (projections.length > 1) {
          projected = projected.sort((a, b) => {
            return a['login'].localeCompare(b['login']);
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
