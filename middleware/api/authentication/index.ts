//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { isJsonError, jsonError } from '../../jsonError.js';
import { CreateError, getProviders } from '../../../lib/transitional.js';
import getCompanySpecificDeployment from '../../companySpecificDeployment.js';
import { ApiRequestToken, ReposApiRequest, wrapErrorForImmediateUserError } from '../../../interfaces/web.js';
import { basicJwtValidateAndParse } from './basicJwt.js';

import type {
  EntraApiTokenValidateError,
  EntraApiTokenValidateResponse,
  EntraApiTokenValidationFunction,
} from './types.js';
import type { IEntraAuthorizationProperties, IProviders } from '../../../interfaces/index.js';

export * from './basicJwt.js';

let apiAuthorizationProvider: EntraApiTokenValidationFunction = null;
let validator: IEntraAuthorizationProperties = null;

export function requireAuthorizedEntraApiScope(scope: string | string[]) {
  return (req: ReposApiRequest, res: Response, next: NextFunction) => {
    const { apiKeyToken } = req;
    if (!apiKeyToken) {
      return next(jsonError('No API key token', 403));
    }
    const scopes = typeof scope === 'string' ? [scope] : scope;
    if (!apiKeyToken.hasAnyScope(scopes)) {
      if (scopes && scopes.join) {
        res.header('x-other-scopes', scopes.join(', '));
      }
      return next(jsonError(`Not authorized for ${scope}`, 403));
    }
    return next();
  };
}

export function requireAuthorizedEntraApiScopePrefix(scopePrefix: string) {
  return (req: ReposApiRequest, res: Response, next: NextFunction) => {
    const { apiKeyToken } = req;
    if (!apiKeyToken) {
      return next(jsonError('No API key token', 403));
    }
    if (apiKeyToken.hasScopePrefix(scopePrefix)) {
      return next();
    }
    return next(jsonError(`Not authorized for scope prefix ${scopePrefix}`, 403));
  };
}

export function requireAnyAuthorizedEntraApiScope(req: ReposApiRequest, res: Response, next: NextFunction) {
  const { apiKeyToken } = req;
  if (!apiKeyToken) {
    return next(jsonError('No API key token', 403));
  }
  if (apiKeyToken.getScopes().length > 0) {
    return next();
  }
  return next(jsonError('Not authorized for any scopes', 403));
}

export default function entraApiValidationMiddleware(
  req: ReposApiRequest,
  res: Response,
  next: NextFunction
) {
  return validateToken(req, res)
    .then(() => {
      return next();
    })
    .catch((err) => {
      if ((err as any).immediate === true) {
        console.warn(`Entra ID API authorization failed: ${err}`);
      }
      return isJsonError(err, req.url) ? next(err) : next(jsonError(err, 500) as unknown);
    });
}

async function validateToken(req: ReposApiRequest, res: Response) {
  const { insights } = getProviders(req);
  if (!apiAuthorizationProvider) {
    apiAuthorizationProvider = firstValidation(req);
  }
  let validatedToken: EntraApiTokenValidateResponse;
  try {
    insights?.trackEvent({
      name: 'api.entra_id.authentication.incoming',
      properties: {
        url: req.url,
        method: req.method,
      },
    });
    validatedToken = await apiAuthorizationProvider(validator, req);
    const { tenantId, clientId, objectId, validator: validationProviderName } = validatedToken;
    insights?.trackEvent({
      name: 'api.entra_id.authenticated',
      properties: {
        tenantId,
        clientId,
        objectId,
        validationProviderName,
      },
    });
  } catch (error) {
    const asValidationError = error as EntraApiTokenValidateError;
    // can we get MISE telemetry or anything?
    insights?.trackException({
      exception: asValidationError,
      properties: {
        name: 'api.entra_id.authentication.error',
        message: asValidationError.message,
        status: asValidationError.status,
        wwwAuthenticate: asValidationError.wwwAuthenticate,
      },
    });
    throw wrapErrorForImmediateUserError(error);
  }
  let apiToken: ApiRequestToken;
  try {
    apiToken = await getAuthorizedApiToken(getProviders(req), validator, validatedToken);
    req.apiKeyToken = apiToken;
    const scopes = apiToken.getScopes() || [];
    scopes.sort();
    const monikerSources = apiToken.getMonikerSources() || [];
    if (scopes && scopes.join) {
      res.header('x-api-scopes', scopes.join(', '));
    }
    const { audience, tenantId, clientId, objectId, validator: validationProviderName } = validatedToken;
    insights?.trackEvent({
      name: 'api.entra_id.authorized',
      properties: {
        audience,
        tenantId,
        clientId,
        objectId,
        validationProviderName,
        authorizedScopes: scopes.join(','),
        monikerSources: monikerSources.join(','),
      },
    });
    insights?.trackMetric({
      name: 'api.entra_id.authorization.successes',
      value: 1,
    });
  } catch (error) {
    const asValidationError = error as EntraApiTokenValidateError;
    insights?.trackException({
      exception: asValidationError,
      properties: {
        name: 'api.entra_id.authorization.error',
        message: asValidationError.message,
        status: asValidationError.status,
        wwwAuthenticate: asValidationError.wwwAuthenticate || 'Unknown',
      },
    });
    insights?.trackMetric({
      name: 'api.entra_id.authorization.errors',
      value: 1,
    });
    throw wrapErrorForImmediateUserError(error);
  }
}

async function getAuthorizedApiToken(
  providers: IProviders,
  validator: IEntraAuthorizationProperties,
  caller: EntraApiTokenValidateResponse
) {
  const { clientId, objectId, tenantId } = caller;
  if (!(await validator.isAuthorizedTenant(tenantId))) {
    throw CreateError.NotAuthorized(`Tenant ${tenantId} is not authorized for this API endpoint`);
  }

  // Who is calling
  const monikerSources = [];
  const approvedAppMonikerClientId = await validator.getAuthorizedClientIdToken(clientId);
  if (approvedAppMonikerClientId) {
    monikerSources.push('client');
  }
  const approvedAppMonikerObjectId = await validator.getAuthorizedObjectIdToken(objectId);
  if (approvedAppMonikerObjectId) {
    monikerSources.push('object');
  }
  const { pairs: approvedPairs, extraContext } = await validator.getAuthorizedClientAndObjectIdTokenPairs(
    tenantId,
    clientId,
    objectId
  );
  const hasApprovedPairs = approvedPairs?.length > 0;
  if (approvedPairs?.length > 0) {
    monikerSources.push('pair');
  }
  const notAuthorized = !approvedAppMonikerClientId && !approvedAppMonikerObjectId && !hasApprovedPairs;
  if (notAuthorized) {
    throw wrapErrorForImmediateUserError(
      CreateError.NotAuthorized(
        `App ${clientId} and object ID ${objectId} is not authorized for this API endpoint`
      )
    );
  }

  // Available statically-configured scopes
  const scopesSet = new Set<string>();
  if (approvedAppMonikerClientId) {
    const clientIdScopes = await validator.getScopes(approvedAppMonikerClientId);
    clientIdScopes.forEach((s) => scopesSet.add(s));
  }
  if (approvedAppMonikerObjectId) {
    const objectIdScopes = await validator.getScopes(approvedAppMonikerObjectId);
    objectIdScopes.forEach((s) => scopesSet.add(s));
  }
  if (hasApprovedPairs) {
    for (const approvedPair of approvedPairs) {
      const pairScopes = await validator.getScopes(approvedPair);
      pairScopes.forEach((s) => scopesSet.add(s));
    }
  }
  const scopes = Array.from(scopesSet);

  const displayValues = await validator.getDisplayValues(
    approvedAppMonikerClientId || approvedAppMonikerObjectId || approvedPairs
  );

  const organizationScopes = '*';

  // Request token instance
  const apiToken: ApiRequestToken = {
    authenticationProvider: caller.validator,
    token: caller,
    hasOrganizationScope: (organizationName: string) => {
      if (organizationScopes === '*') {
        return true;
      }
      const orgs = (organizationScopes as string).toLowerCase().split(',');
      return orgs.includes(organizationName.toLowerCase());
    },
    extraContext,
    getMonikerSources: () => monikerSources,
    getScopes: () => scopes,
    hasScope: (scope: string) => {
      if (!scopes) {
        return false;
      }
      return scopes.includes(scope);
    },
    hasScopePrefix: (scopePrefix: string) => {
      if (!scopes) {
        return false;
      }
      for (const scope of scopes) {
        if (scope.startsWith(scopePrefix)) {
          return true;
        }
      }
      return false;
    },
    hasAnyScope: (scopesList: string[]) => {
      if (!scopes) {
        return false;
      }
      for (const scope of scopesList) {
        if (scopes.includes(scope)) {
          return true;
        }
      }
      return false;
    },
    displayUsername: displayValues?.displayName
      ? `${displayValues.displayName}${
          displayValues.contactAddress ? ' (' + displayValues.contactAddress + ')' : ''
        }`
      : 'Entra ID identity',
  };
  const asAny = apiToken as any;
  asAny.appId = clientId;
  asAny.oid = objectId;
  asAny.organizationScopes = scopes.join(',');
  asAny.displayValues = displayValues;
  asAny.corporateId = null;
  asAny.description = `Entra ID oid ${objectId} app ${clientId} with scopes ${scopes}`;
  asAny.source = `Entra ID oid ${objectId} app ${clientId}`;
  return apiToken;
}

function firstValidation(req: ReposApiRequest): EntraApiTokenValidationFunction {
  const { config } = getProviders(req);
  const provider = config?.activeDirectory?.api?.authentication?.provider;
  if (!provider) {
    throw CreateError.InvalidParameters('No Entra ID API authentication provider configured');
  }

  const companySpecificDeployment = getCompanySpecificDeployment();
  // authorization validator
  validator = companySpecificDeployment?.middleware?.authentication?.getEntraApiAuthorizationValidator
    ? companySpecificDeployment.middleware.authentication.getEntraApiAuthorizationValidator(getProviders(req))
    : null;
  if (!validator) {
    throw CreateError.InvalidParameters(
      'No AAD API validator. The open source version of this project does not ship with a default currently.'
    );
  }

  // token validator
  if (companySpecificDeployment?.middleware?.authentication?.getEntraApiTokenValidator) {
    const provider = companySpecificDeployment.middleware.authentication.getEntraApiTokenValidator(
      getProviders(req)
    );
    if (provider) {
      return provider;
    }
  }
  if (provider === 'msal') {
    return basicJwtValidateAndParse;
  }
  throw CreateError.NotImplemented(`API authentication provider ${provider} not implemented`);
}
