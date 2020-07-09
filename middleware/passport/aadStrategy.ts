//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IProviders } from '../../transitional';

import { OIDCStrategy } from 'passport-azure-ad';

function activeDirectorySubset(app, iss, sub, profile, done) {
  const config = app.settings.runtimeConfig;
  const providers = app.settings.providers as IProviders;
  if (config && config.impersonation && config.impersonation.corporateId) {
    const impersonationCorporateId = config.impersonation.corporateId;
    return providers.graphProvider.getUserById(impersonationCorporateId, (err, impersonationResult) => {
      if (err) {
        return done(err);
      }
      console.warn(`IMPERSONATION: id=${impersonationResult.id} upn=${impersonationResult.userPrincipalName} name=${impersonationResult.displayName}`);
      return done(null, {
        azure: {
          displayName: impersonationResult.displayName,
          oid: impersonationResult.id,
          username: impersonationResult.userPrincipalName,
        },
      });
    });
  }
  const subset = {
    azure: {
      displayName: profile.displayName,
      oid: profile.oid,
      username: profile.upn,
    },
  };
  return done(null, subset);
}

export default function createAADStrategy(app, config) {
  let aadStrategy = new OIDCStrategy({
    redirectUrl: config.activeDirectory.redirectUrl || `${config.webServer.baseUrl}/auth/azure/callback`,
    allowHttpForRedirectUrl: config.containers.docker || config.webServer.allowHttp,
    // @ts-ignore
    realm: config.activeDirectory.tenantId,
    clientID: config.activeDirectory.clientId,
    clientSecret: config.activeDirectory.clientSecret,
    identityMetadata: 'https://login.microsoftonline.com/' + config.activeDirectory.tenantId + '/.well-known/openid-configuration',
    responseType: 'id_token code',
    responseMode: 'form_post',
    // oidcIssuer: config.activeDirectory.issuer,
    // validateIssuer: true,
  }, activeDirectorySubset.bind(null, app));

  // Patching the AAD strategy to intercept a specific state failure message and instead
  // of providing a generic failure message, redirecting (HTTP GET) to the callback page
  // where we can offer a more useful message
  // @ts-ignore
  const originalFailWithLog = aadStrategy.failWithLog;
  // @ts-ignore
  aadStrategy.failWithLog = function () {
    const args = Array.prototype.slice.call(arguments);
    const messageToIntercept = 'In collectInfoFromReq: invalid state received in the request';
    if (args.length === 1 && typeof (args[0]) === 'string' && args[0] === messageToIntercept) {
      return this.redirect('/auth/azure/callback?failure=invalid');
    } else if (args.length === 1 && typeof (args[0]) === 'string') {
      console.warn(`AAD Failure: ${args[0]}`);
    }
    originalFailWithLog.call(this, args);
  };
  return { 'azure-active-directory': aadStrategy };
}
