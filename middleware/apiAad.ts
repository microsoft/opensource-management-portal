//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

import { isJsonError, jsonError } from './jsonError';
import { IApiRequest, wrapErrorForImmediateUserError } from './apiReposAuth';
import { PersonalAccessToken } from '../entities/token/token';
import { getProviders } from '../transitional';

// TODO: Caching of signing keys

interface IConfigAadApiApprovedAppsOrOids {
  scopes: {
    read: {
      links: string[] | string;
      maintainers: string[] | string;
    };
    create: {
      repos: string[] | string;
    };
  };
}

export default function AadApiMiddleware(req: IApiRequest, res, next) {
  return validateAadAuthorization(req)
    .then((ok) => {
      return next();
    })
    .catch((err) => {
      if ((err as any).immediate === true) {
        console.warn(`AAD API authorization failed: ${err}`);
      }
      return isJsonError(err) ? next(err) : jsonError(err, 500);
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

export function getAadApiConfiguration(config: any) {
  const allowedTenants = Array.isArray(config?.microsoft?.api?.aad?.authorizedTenants)
    ? config.microsoft.api.aad.authorizedTenants
    : (config?.microsoft?.api?.aad?.authorizedTenants || '').split(',');
  if (!allowedTenants) {
    throw jsonError('App not configured for authorizing specific tenants', 500);
  }

  let reposApiAudienceIdentities = config?.microsoft?.api?.aad?.apiAppScopes
    ? (config.microsoft.api.aad.apiAppScopes as string).split(',')
    : null;
  if (!reposApiAudienceIdentities) {
    const reposApiAudienceIdentity = config?.microsoft?.api?.aad?.apiAppScope
      ? [config.microsoft.api.aad.apiAppScope]
      : null;
    if (!reposApiAudienceIdentity) {
      throw jsonError('App not configured for authorizing APIs via AAD', 500);
    }
    reposApiAudienceIdentities = reposApiAudienceIdentity;
  }
  if (!reposApiAudienceIdentities) {
    throw jsonError('App not configured for authorizing APIs via AAD', 500);
  }

  let approvedApps = config?.microsoft?.api?.aad?.approvedApps as IConfigAadApiApprovedAppsOrOids;
  if (approvedApps === undefined) {
    throw jsonError('AAD API app authentication is not configured', 500);
  }

  let approvedOids = config?.microsoft?.api?.aad?.approvedOids as IConfigAadApiApprovedAppsOrOids;
  if (approvedApps === undefined) {
    throw jsonError('AAD API OID authentication is not configured', 500);
  }

  // Any app that has a valid scope can call the API, but may not be scoped and will error out in the API tier
  const approvedAppsToCreateRepos = Array.isArray(approvedApps?.scopes?.create?.repos)
    ? approvedApps?.scopes?.create?.repos
    : approvedApps?.scopes?.create?.repos?.split
    ? [...approvedApps.scopes.create.repos.split(',')]
    : [];
  const approvedAppsToReadLinks = Array.isArray(approvedApps?.scopes?.read?.links)
    ? approvedApps?.scopes?.read?.links
    : approvedApps?.scopes?.read?.links?.split
    ? [...approvedApps.scopes.read.links.split(',')]
    : [];
  const approvedAppsToReadMaintainers = Array.isArray(approvedApps?.scopes?.read?.maintainers)
    ? approvedApps?.scopes?.read?.maintainers
    : approvedApps?.scopes?.read?.maintainers?.split
    ? [...approvedApps.scopes.read.maintainers.split(',')]
    : [];
  const approvedAppsToReadJitConfirms = Array.isArray(approvedApps?.scopes?.read?.['jit/confirm'])
    ? approvedApps?.scopes?.read?.['jit/confirm']
    : approvedApps?.scopes?.read?.['jit/confirm']?.split
    ? [...approvedApps.scopes.read['jit/confirm'].split(',')]
    : [];

  const approvedOidsToCreateRepos = Array.isArray(approvedOids?.scopes?.create?.repos)
    ? approvedOids?.scopes?.create?.repos
    : approvedOids?.scopes?.create?.repos?.split
    ? [...(approvedOids?.scopes?.create?.repos ? approvedOids.scopes.create.repos.split(',') : [])]
    : [];
  const approvedOidsToReadLinks = Array.isArray(approvedOids?.scopes?.read?.links)
    ? approvedOids?.scopes?.read?.links
    : approvedOids?.scopes?.read?.links?.split
    ? [...(approvedOids?.scopes?.read?.links ? approvedOids.scopes.read.links.split(',') : [])]
    : [];
  const approvedOidsToReadJitConfirms = Array.isArray(approvedOids?.scopes?.read?.['jit/confirm'])
    ? approvedOids?.scopes?.read?.['jit/confirm']
    : approvedOids?.scopes?.read?.['jit/confirm']?.split
    ? [...approvedOids.scopes.read['jit/confirm'].split(',')]
    : [];

  const oids = [...approvedOidsToCreateRepos, ...approvedOidsToReadLinks, ...approvedOidsToReadJitConfirms];
  const appIds = [
    // hacky temporary design for pulling from config
    ...approvedAppsToCreateRepos,
    ...approvedAppsToReadLinks,
    ...approvedAppsToReadMaintainers,
    ...approvedAppsToReadJitConfirms,
  ];

  return {
    allowedTenants,
    reposApiAudienceIdentities,
    oids,
    appIds,
    approvedAppsToCreateRepos,
    approvedAppsToReadLinks,
    approvedAppsToReadMaintainers,
    approvedOidsToCreateRepos,
    approvedOidsToReadLinks,
    approvedAppsToReadJitConfirms,
    approvedOidsToReadJitConfirms,
  };
}

async function validateAadAuthorization(req: IApiRequest): Promise<void> {
  const { config, insights } = getProviders(req);
  const {
    allowedTenants,
    reposApiAudienceIdentities,
    oids,
    appIds,
    approvedAppsToCreateRepos,
    approvedAppsToReadLinks,
    approvedAppsToReadMaintainers,
    approvedOidsToCreateRepos,
    approvedOidsToReadLinks,
    approvedAppsToReadJitConfirms,
    approvedOidsToReadJitConfirms,
  } = getAadApiConfiguration(config);

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

    const issuer = decodedToken['iss'] as string;
    let isValidTenant = false;
    for (let i = 0; isValidTenant === false && i < allowedTenants.length; i++) {
      const tenant = allowedTenants[i];
      const stsUrl = `https://sts.windows.net/${tenant}/`;
      isValidTenant = issuer.startsWith(stsUrl); // support v1.0 or v2.0 as a result
    }

    // JWT steps:
    // [X] aud: needs to match app ID
    // [X] iss: guid portion is the tenant, confirm it's an approved issuer we want
    // [X] nbr, exp times (jwt verifies this)
    // [X] appid: the client app [*we check our list for this]
    const validationOptions = {
      audience: reposApiAudienceIdentities,
      issuer,
    };

    const payload = await callJwtVerify(token, validationOptions);
    // console.dir(payload);

    if (!isValidTenant) {
      throw wrapErrorForImmediateUserError(
        jsonError(`Issuer ${issuer} is not authorized for this API endpoint`, 403)
      );
    }

    const { appid, oid } = payload as any;

    const scopes = [];

    const isAppApproved = appIds.includes(appid);
    const isOidApproved = oids.includes(oid);
    const notAuthorized = isAppApproved === false && isOidApproved === false;
    if (notAuthorized) {
      throw wrapErrorForImmediateUserError(
        jsonError(`App ${appid} and object ID ${oid} is not authorized for this API endpoint`, 403)
      );
    }
    if (isAppApproved && approvedAppsToCreateRepos.includes(appid)) {
      scopes.push('createRepo');
    }
    if (isAppApproved && approvedAppsToReadLinks.includes(appid)) {
      scopes.push('links');
    }
    if (isAppApproved && approvedAppsToReadMaintainers.includes(appid)) {
      scopes.push('maintainers');
    }
    if (isAppApproved && approvedAppsToReadJitConfirms.includes(appid)) {
      scopes.push('jit/confirm');
    }
    if (isOidApproved && approvedOidsToCreateRepos.includes(oid)) {
      scopes.push('createRepo');
    }
    if (isOidApproved && approvedOidsToReadLinks.includes(oid)) {
      scopes.push('links');
    }
    if (isOidApproved && approvedOidsToReadJitConfirms.includes(oid)) {
      scopes.push('jit/confirm');
    }

    const apiToken = PersonalAccessToken.CreateFromAadAuthorization({
      appId: appid,
      oid,
      scopes: scopes.join(','),
      organizationScopes: '*',
    });
    req.apiKeyToken = apiToken;
    req.apiKeyProviderName = 'aad';
    insights?.trackEvent({
      name: 'ApiAadAppAuthorized',
      properties: Object.assign({}, decodedToken as any, {
        authorizedScopes: scopes.join(','),
      }),
    });
  } catch (error) {
    insights?.trackException({ exception: error });
    throw wrapErrorForImmediateUserError(jsonError(`AAD unauthorized: ${error.message || error}`, 403));
  }
}
