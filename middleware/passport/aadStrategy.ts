//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IProviders } from '../../transitional';

import { OIDCStrategy } from 'passport-azure-ad';
import { GraphUserType } from '../../lib/graphProvider';

interface IPassportUserWithAAD {
  azure?: IAADUser;
}

interface IAADUser {
  displayName: string;
  oid: string;
  username: string;
}

async function login(app, config, iss, sub, profile): Promise<IPassportUserWithAAD> {
  const { graphProvider } = app.settings.providers as IProviders;
  if (config && config.impersonation && config.impersonation.corporateId) {
    const impersonationCorporateId = config.impersonation.corporateId;
    const impersonationResult = await graphProvider.getUserByIdAsync(impersonationCorporateId);
    console.warn(`IMPERSONATION: id=${impersonationResult.id} upn=${impersonationResult.userPrincipalName} name=${impersonationResult.displayName}`);
    return {
      azure: {
        displayName: impersonationResult.displayName,
        oid: impersonationResult.id,
        username: impersonationResult.userPrincipalName,
      },
    };
  }
  if (config.activeDirectory.blockGuestSignIns === true) {
    const lookupResult = await graphProvider.getUserByIdAsync(profile.oid);
    if (lookupResult && lookupResult.userType === GraphUserType.Guest) {
      throw new Error(`This application does not permit guests. You are currently signed in to Active Directory as: ${lookupResult.userPrincipalName}`);
    }
  }
  return {
    azure: {
      displayName: profile.displayName,
      oid: profile.oid,
      username: profile.upn,
    },
  };
}

function activeDirectorySubset(app, config, iss, sub, profile, done) {
  login(app, config, iss, sub, profile).then(profile => {
    return done(null, profile);
  }).catch(error => {
    return done(error);
  });
}

export default function createAADStrategy(app, config) {
  const { redirectUrl, tenantId, clientId, clientSecret } = config.activeDirectory;
  let aadStrategy = new OIDCStrategy({
    redirectUrl: redirectUrl || `${config.webServer.baseUrl}/auth/azure/callback`,
    allowHttpForRedirectUrl: config.containers.docker || config.webServer.allowHttp,
    // @ts-ignore
    realm: tenantId,
    clientID: clientId,
    clientSecret: clientSecret,
    identityMetadata: `https://login.microsoftonline.com/${tenantId}/.well-known/openid-configuration`,
    responseType: 'id_token code',
    responseMode: 'form_post',
    // oidcIssuer: config.activeDirectory.issuer,
    // validateIssuer: true,
  }, activeDirectorySubset.bind(null, app, config));
  // Patching the AAD strategy to intercept a specific state failure message and instead
  // of providing a generic failure message, redirecting (HTTP GET) to the callback page
  // where we can offer a more useful message
  // @ts-ignore
  const originalFailWithLog = aadStrategy.failWithLog;
  // @ts-ignore
  aadStrategy.failWithLog = function () {
    const args = Array.prototype.slice.call(arguments);
    const messageToIntercept = 'In collectInfoFromReq: invalid state received in the request';
    if (args.length === 1 && typeof (args[0]) === 'string') {
      console.warn(`AAD Failure: clientId=${clientId}, tenantId=${tenantId}, message=${args[0]}`);
    }
    if (args.length === 1 && typeof (args[0]) === 'string' && args[0] === messageToIntercept) {
      return this.redirect('/auth/azure/callback?failure=invalid');
    }
    return originalFailWithLog.call(this, args);
  };
  return { 'azure-active-directory': aadStrategy };
}
