//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

import { isJsonError, jsonError } from './jsonError';
import { IApiRequest, wrapErrorForImmediateUserError } from './apiReposAuth';
import { PersonalAccessToken } from '../business/entities/token/token';
import { CreateError, getProviders } from '../lib/transitional';
import getCompanySpecificDeployment from './companySpecificDeployment';

// CONSIDER: Caching of signing keys

export function requireAadApiAuthorizedScope(scope: string | string[]) {
  return (req: IApiRequest, res: Response, next: NextFunction) => {
    const { apiKeyToken } = req;
    const scopes = typeof scope === 'string' ? [scope] : scope;
    if (!apiKeyToken.hasAnyScope(scopes)) {
      return next(jsonError(`Not authorized for ${scope}`, 403));
    }
    return next();
  };
}

export default function aadApiMiddleware(req: IApiRequest, res: Response, next: NextFunction) {
  return validateAadAuthorization(req)
    .then((ok) => {
      return next();
    })
    .catch((err) => {
      if ((err as any).immediate === true) {
        console.warn(`AAD API authorization failed: ${err}`);
      }
      return isJsonError(err, req.url) ? next(err) : (jsonError(err, 500) as unknown);
    });
}

function callJwtVerify(token: string, options?: jwt.VerifyOptions) {
  return new Promise((resolve, reject) => {
    return jwt.verify(token, getSigningKeys, options, (err, payload) => {
      return err ? reject(err) : resolve(payload);
    });
  });
}

function getSigningKeys(header, callback) {
  const client = jwksClient({
    jwksUri: 'https://login.microsoftonline.com/common/discovery/keys',
  });
  client
    .getSigningKey(header.kid)
    .then((key) => {
      if (!key) {
        return callback(new Error('no signing key'));
      }
      const signingKey = key['publicKey'] || key['rsaPublicKey']; // typings claim these are not valid properties
      return callback(null, signingKey);
    })
    .catch((err) => {
      return callback(err);
    });
}

async function validateAadAuthorization(req: IApiRequest): Promise<void> {
  const { insights } = getProviders(req);

  const authorizationHeader = req.headers.authorization;
  if (!authorizationHeader) {
    throw jsonError('No authorization header', 401);
  }

  const tokenComponents = authorizationHeader.split(' ');
  if (tokenComponents.length < 2) {
    throw jsonError('Invalid header', 401);
  }

  if (tokenComponents[0].toLowerCase() !== 'bearer') {
    throw jsonError('Not a bearer token', 401);
  }

  const token = tokenComponents[1];
  try {
    const decodedToken = jwt.decode(token);
    insights?.trackEvent({
      name: 'ApiAadJwtDecoded',
      properties: decodedToken as any,
    });

    const companySpecificDeployment = getCompanySpecificDeployment();
    const aadApiValidator = companySpecificDeployment?.middleware?.authentication
      ?.getAadApiAuthenticationValidator
      ? companySpecificDeployment.middleware.authentication.getAadApiAuthenticationValidator(
          getProviders(req)
        )
      : null;
    if (!aadApiValidator) {
      throw CreateError.InvalidParameters('No AAD API validator');
    }

    const issuer = decodedToken['iss'] as string;
    const isValidTenant = aadApiValidator.isAuthorizedTenant(issuer);

    // JWT steps:
    // [X] aud: needs to match app ID
    // [X] iss: guid portion is the tenant, confirm it's an approved issuer we want
    // [X] nbr, exp times (jwt verifies this)
    // [X] appid: the client app [*we check our list for this]
    const validationOptions = {
      audience: await aadApiValidator.getAudienceIdentities(),
      issuer,
    };

    const payload = await callJwtVerify(token, validationOptions);

    if (!isValidTenant) {
      throw wrapErrorForImmediateUserError(
        jsonError(`Issuer ${issuer} is not authorized for this API endpoint`, 403)
      );
    }

    const { appid, oid } = payload as any;
    const monikerSources = [];
    const approvedAppMonikerClientId = await aadApiValidator.getAuthorizedClientIdToken(appid);
    if (approvedAppMonikerClientId) {
      monikerSources.push('client');
    }
    const approvedAppMonikerObjectId = await aadApiValidator.getAuthorizedObjectIdToken(oid);
    if (approvedAppMonikerObjectId) {
      monikerSources.push('object');
    }

    const notAuthorized = !approvedAppMonikerClientId && !approvedAppMonikerObjectId;
    if (notAuthorized) {
      throw wrapErrorForImmediateUserError(
        jsonError(`App ${appid} and object ID ${oid} is not authorized for this API endpoint`, 403)
      );
    }

    const scopesSet = new Set<string>();
    if (approvedAppMonikerClientId) {
      const clientIdScopes = await aadApiValidator.getScopes(approvedAppMonikerClientId);
      clientIdScopes.forEach((s) => scopesSet.add(s));
    }
    if (approvedAppMonikerObjectId) {
      const objectIdScopes = await aadApiValidator.getScopes(approvedAppMonikerObjectId);
      objectIdScopes.forEach((s) => scopesSet.add(s));
    }
    const scopes = Array.from(scopesSet);

    const displayValues = await aadApiValidator.getDisplayValues(
      approvedAppMonikerClientId || approvedAppMonikerObjectId
    );

    const apiToken = PersonalAccessToken.CreateFromAadAuthorization(
      {
        appId: appid,
        oid,
        scopes: scopes.join(','),
        organizationScopes: '*',
      },
      displayValues
    );
    req.apiKeyToken = apiToken;
    req.apiKeyProviderName = 'aad';
    insights?.trackEvent({
      name: 'ApiAadAppAuthorized',
      properties: Object.assign({}, decodedToken as any, {
        authorizedScopes: scopes.join(','),
        monikerSources: monikerSources.join(','),
      }),
    });
  } catch (error) {
    insights?.trackException({ exception: error });
    throw wrapErrorForImmediateUserError(jsonError(`AAD unauthorized: ${error.message || error}`, 403));
  }
}
