//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import bodyParser from 'body-parser';
import { NextFunction, Response, Router } from 'express';
const router: Router = Router();

import cors from 'cors';

import { CreateError, getProviders } from '../lib/transitional.js';
import { jsonError } from '../middleware/index.js';

import apiWebhook from './webhook.js';
import apiPeople from './people/index.js';
import apiNews from './client/news.js';

import aadApiAuthentication, {
  requireAnyAuthorizedEntraApiScope,
  requireAuthorizedEntraApiScope,
} from '../middleware/api/authentication/index.js';
import { createRepositoryCore, CreateRepositoryEntrypoint } from './createRepo.js';
import jsonErrorHandler from './jsonErrorHandler.js';
import getCompanySpecificDeployment from '../middleware/companySpecificDeployment.js';

import type { ReposApiRequest, ReposAppRequest, SiteConfiguration } from '../interfaces/index.js';
import type { CreateRepositoryRequest } from './client/newOrgRepo.js';

const hardcodedApiVersions = ['2019-10-01', '2019-02-01', '2017-09-01', '2017-03-08', '2016-12-01'];

const MOST_RECENT_VERSION = hardcodedApiVersions[0];
const CLIENT_ROUTE_PREFIX = '/client';

function skipApiVersionCheck(req: ReposAppRequest, prefixes: string[]) {
  for (const prefix of prefixes) {
    if (req.path.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function isClientRoute(req: ReposAppRequest) {
  return req.path.startsWith(CLIENT_ROUTE_PREFIX);
}

export default function routeApi(config: SiteConfiguration) {
  if (!config) {
    throw CreateError.InvalidParameters('No configuration provided to the API routes');
  }
  const companySpecificDeployment = getCompanySpecificDeployment();
  const skipApiVersionChecksForPrefixes =
    companySpecificDeployment?.routes?.api?.skipApiVersionChecksForPrefixes || [];
  const combinedSkipVersionPrefixes = [CLIENT_ROUTE_PREFIX, ...skipApiVersionChecksForPrefixes];

  router.use('/webhook', apiWebhook);

  router.use((req: ReposApiRequest, res: Response, next: NextFunction) => {
    if (skipApiVersionCheck(req, combinedSkipVersionPrefixes)) {
      // The frontend client routes are hooked into Express after
      // the session middleware. The client route does not require
      // an API version. Also, some APIs do not require a version.
      req.apiVersion = MOST_RECENT_VERSION;
      return next();
    }
    const apiVersion = (req.query['api-version'] || req.headers['api-version']) as string;
    if (!apiVersion) {
      return next(jsonError('This endpoint requires that an API Version be provided.', 422));
    }
    if (apiVersion.toLowerCase() === '2016-09-22_Preview'.toLowerCase()) {
      return next(
        jsonError(
          'This endpoint no longer supports the original preview version. Please update your client to use a newer version such as ' +
            hardcodedApiVersions[0],
          422
        )
      );
    }
    if (hardcodedApiVersions.indexOf(apiVersion.toLowerCase()) < 0) {
      return next(
        jsonError('This endpoint does not support the API version you provided at this time.', 422)
      );
    }
    req.apiVersion = apiVersion;
    return next();
  });

  //-----------------------------------------------------------------------------
  // AUTHENTICATION: Entra ID
  //-----------------------------------------------------------------------------
  router.use((req: ReposApiRequest, res, next) => {
    if (isClientRoute(req)) {
      return next();
    }
    return aadApiAuthentication(req, res, (err?: any) => {
      if (err) {
        return next(err);
      }
      return requireAnyAuthorizedEntraApiScope(req, res, next);
    });
  });

  // Authorized users and apps get a larger payload limit
  const { largeApiPayloadLimit } = config.web;
  if (largeApiPayloadLimit) {
    router.use(bodyParser.json({ limit: largeApiPayloadLimit }));
  } else {
    router.use(bodyParser.json());
  }

  router.get('/ping', cors(), (req: ReposApiRequest, res) => {
    res.json({ pong: true });
  });
  router.use('/people', cors(), apiPeople);
  router.use('/news', cors(), requireAuthorizedEntraApiScope('news'), apiNews);

  //-----------------------------------------------------------------------------
  // AUTHENTICATION: Entra ID (company-specific endpoints)
  //-----------------------------------------------------------------------------
  const dynamicStartupInstance = getCompanySpecificDeployment();
  if (dynamicStartupInstance?.routes?.api?.index) {
    dynamicStartupInstance?.routes?.api?.rootIndex(router);
  }

  router.post(
    '/:org/repos',
    requireAuthorizedEntraApiScope(['repo/create']),
    function (req: ReposApiRequest, res: Response, next: NextFunction) {
      const hasBlockedScope = req.apiKeyToken.hasScope('repo/create:legacy-block');
      if (hasBlockedScope) {
        return next(
          CreateError.InvalidParameters(
            'NOTE: there is a newer API available to create repositories that your application should use. Please POST to /api/organizations/:org/repositories instead.'
          )
        );
      }
      const orgName = req.params.org;
      if (!req.apiKeyToken.hasOrganizationScope) {
        return next(
          jsonError(
            'There is a problem with the key configuration (does not support organization scopes)',
            412
          )
        );
      }
      // '*'' is authorized for all organizations in this configuration environment
      if (!req.apiKeyToken.hasOrganizationScope(orgName)) {
        return next(CreateError.NotAuthorized('The key is not authorized for this organization'));
      }

      const providers = getProviders(req);
      const operations = providers.operations;
      let organization = null;
      try {
        organization = operations.getOrganization(orgName);
      } catch (ex) {
        return next(jsonError(ex, 400));
      }
      req.organization = organization;
      return next();
    }
  );

  router.post(
    '/:org/repos',
    async function (req: CreateRepositoryRequest, res: Response, next: NextFunction) {
      const providers = getProviders(req);
      const organization = req.organization;
      const convergedObject = Object.assign({}, req.headers);
      req.insights.trackEvent({ name: 'ApiRepoCreateRequest', properties: convergedObject });
      Object.assign(convergedObject, req.body);
      delete convergedObject.access_token;
      delete convergedObject.authorization;
      const logic = providers.customizedNewRepositoryLogic;
      const customContext = logic?.createContext(req);
      /*
    removed approvals from primary method:

    // Validate approval types
    const msApprovalType = msProperties.approvalType;
    if (!msApprovalType) {
      throw jsonError(new Error('Missing corporate approval type information'), 422);
    }
    if (hardcodedApprovalTypes.indexOf(msApprovalType) < 0) {
      throw jsonError(new Error('The provided approval type is not supported'), 422);
    }
    // Validate specifics of what is in the approval
    switch (msApprovalType) {
      case 'NewReleaseReview':
      case 'ExistingReleaseReview':
        if (!msProperties.approvalUrl) {
          throw jsonError(new Error('Approval URL for the release review is required when using the release review approval type'), 422);
        }
        break;
      case 'SmallLibrariesToolsSamples':
        break;
      case 'Exempt':
        if (!msProperties.justification) {
          throw jsonError(new Error('Justification is required when using the exempted approval type'), 422);
        }
        break;
      default:
        throw jsonError(new Error('The requested approval type is not currently supported.'), 422);
    }

    */
      try {
        const repoCreateResponse = await createRepositoryCore(
          req,
          organization,
          logic,
          customContext,
          convergedObject,
          CreateRepositoryEntrypoint.Api
        );
        res.status(201);
        req.insights.trackEvent({
          name: 'ApiRepoCreateRequestSuccess',
          properties: {
            request: JSON.stringify(convergedObject),
            response: JSON.stringify(repoCreateResponse),
          },
        });
        return res.json(repoCreateResponse) as unknown as void;
      } catch (error) {
        const data = { ...convergedObject };
        data.error = error.message;
        data.encodedError = JSON.stringify(error);
        req.insights.trackEvent({ name: 'ApiRepoCreateFailed', properties: data });
        return next(error);
      }
    }
  );

  router.use((req: ReposApiRequest, res: Response, next: NextFunction) => {
    if (isClientRoute(req)) {
      // The frontend client routes are hooked into Express after
      // the session middleware. The client route does not require
      // an API version.
      return next();
    }
    console.warn(`Requested API endpoint not found: ${req.method} ${req.originalUrl}`);
    // TODO: add params here for insights...
    const error = CreateError.NotFound('The API endpoint was not found.');
    (error as any).insightsProperties = {
      method: req.method,
      url: req.originalUrl,
    };
    return next(error);
  });

  router.use(jsonErrorHandler);

  return router;
}
