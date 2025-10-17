//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import jwt, { type VerifyOptions } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

import { CreateError, ErrorHelper } from '../../../lib/transitional.js';
import { ReposApiRequest, wrapErrorForImmediateUserError } from '../../../interfaces/web.js';

import type { EntraApiTokenValidateError, EntraApiTokenValidateResponse } from './types.js';
import type { IEntraAuthorizationProperties } from '../../../interfaces/index.js';

const VALIDATOR_NAME = 'msal';

export async function basicJwtValidateAndParse(
  aadApiValidator: IEntraAuthorizationProperties,
  req: ReposApiRequest
): Promise<EntraApiTokenValidateResponse> {
  const authorizationHeader = req.headers.authorization;
  // prettier-ignore
  if (!authorizationHeader) { // CodeQL [SM01513] not a security decision just validation
    throw CreateError.NotAuthenticated('No authorization header');
  }
  const tokenComponents = authorizationHeader.split(' ');
  // prettier-ignore
  if (tokenComponents.length < 2) { // CodeQL [SM01513] not a security decision just validation
    throw CreateError.NotAuthenticated('Invalid header');
  }
  // prettier-ignore
  if (tokenComponents[0].toLowerCase() !== 'bearer') { // CodeQL [SM01513] not a security decision just validation
    throw CreateError.NotAuthenticated('Not a bearer token');
  }
  const token = tokenComponents[1];
  try {
    const decodedToken = jwt.decode(token);
    if (!decodedToken) {
      throw CreateError.InvalidParameters('No decoded token');
    }
    const issuer = decodedToken['iss'] as string;
    const isValidTenant = aadApiValidator.isAuthorizedTenant(issuer);
    if (!isValidTenant) {
      throw wrapErrorForImmediateUserError(
        CreateError.NotAuthorized(`Issuer ${issuer} is not authorized for this API endpoint`)
      );
    }
    // JWT steps:
    // [X] aud: needs to match app ID
    // [X] iss: guid portion is the tenant, confirm it's an approved issuer we want
    // [X] nbr, exp times (jwt verifies this)
    // [X] appid: the client app [*we check our list for this]
    const audience = await aadApiValidator.getAudienceIdentities();
    if (!audience || audience.length === 0) {
      throw CreateError.InvalidParameters('No audience identities configured');
    }
    const validationOptions: VerifyOptions = {
      audience: audience.length === 1 ? audience[0] : (audience as [string, ...string[]]),
      issuer,
    };
    const payload = await callJwtVerify(token, validationOptions);
    const { aud, appid, oid, tid } = payload as any as {
      appid: string;
      oid: string;
      aud: string;
      tid: string;
    };
    const validated: EntraApiTokenValidateResponse = {
      validator: VALIDATOR_NAME,
      audience: aud,
      tenantId: tid,
      clientId: appid,
      objectId: oid,
    };
    return validated;
  } catch (error) {
    const asValidatorError = error as EntraApiTokenValidateError;
    if (!asValidatorError.status) {
      asValidatorError.status = ErrorHelper.GetStatus(error) || 401;
    }
    if (!asValidatorError.wwwAuthenticate) {
      asValidatorError.wwwAuthenticate = 'Unknown specific authentication error';
    }
    throw error;
  }
}

function callJwtVerify(token: string, options?: VerifyOptions) {
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
