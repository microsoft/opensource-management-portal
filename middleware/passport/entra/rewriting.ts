//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { CreateError, splitSemiColonCommas } from '../../../lib/transitional.js';
import { GraphUserType } from '../../../lib/graphProvider/index.js';

import type { SiteConfiguration } from '../../../config/index.types.js';
import type { AadResponseProfile, PassportUserWithEntraID } from './types.js';
import type { IProviders } from '../../../interfaces/providers.js';

export async function processUserProfile(
  providers: IProviders,
  profile: AadResponseProfile
): Promise<PassportUserWithEntraID> {
  const { config, graphProvider, insights } = providers;
  if (config?.activeDirectory?.authentication?.developmentTenantRewriting?.enabled) {
    rewriteUserProfile(config, profile);
  }
  if (config?.impersonation?.corporateId) {
    const impersonationCorporateId = config.impersonation.corporateId;
    const impersonationResult = await graphProvider.getUserById(impersonationCorporateId);
    console.warn(
      `IMPERSONATION: id=${impersonationResult.id} upn=${impersonationResult.userPrincipalName} name=${impersonationResult.displayName} graphIsNotImpersonatedAs=${profile.upn}`
    );
    return {
      azure: {
        displayName: impersonationResult.displayName,
        oid: impersonationResult.id,
        username: impersonationResult.userPrincipalName,
        tenantId: config.impersonation.tenantId,
      },
    };
  }
  const activeDirectory = config.activeDirectory;
  const { authentication } = activeDirectory;
  if (authentication?.isMultiTenant === true) {
    const allowedTenantIds = splitSemiColonCommas(authentication.allowedTenantIds);
    if (!allowedTenantIds.includes(profile.tenantId)) {
      const err = new Error(
        `This application does not permit sign-ins from the tenant ${profile.tenantId} for ${profile.upn}.`
      );
      insights?.trackException({
        exception: err,
        properties: {
          eventName: 'EntraIDTenantNotAllowed',
        },
      });
      throw err;
    }
  }
  if (authentication?.blockGuestSignIns === true) {
    const lookupResult = await graphProvider.getUserById(profile.oid);
    if (!lookupResult) {
      const err = new Error(
        `User ${profile.upn || profile.oid} could not be found in the corporate directory.`
      );
      insights?.trackException({ exception: err });
      throw err;
    } else if (lookupResult?.userType === GraphUserType.Guest) {
      const err = new Error(
        `This application does not permit guests. You are currently signed in to Active Directory as: ${lookupResult.userPrincipalName}`
      );
      insights?.trackException({ exception: err });
      throw err;
    }
  }
  return {
    azure: {
      displayName: profile.displayName,
      oid: profile.oid,
      username: profile.upn,
      tenantId: profile.tenantId,
    },
  };
}

export function rewriteUserProfile(config: SiteConfiguration, profile: AadResponseProfile) {
  const { authentication } = config.activeDirectory;
  const { developmentTenantRewriting } = authentication;
  let redirectUrl: string;
  if (config.authentication.scheme === 'entra-id') {
    redirectUrl = config.activeDirectory.authentication.entraManagedIdentityAuthentication.redirectUrl;
  }
  if (!redirectUrl) {
    throw CreateError.InvalidParameters(
      'Missing redirectUrl for developmentTenantRewriting with scheme ' + config.authentication.scheme
    );
  }
  const { from, to } = developmentTenantRewriting;
  if (!from.id || !from.tenant || !from.upn || !to.id || !to.tenant || !to.upn) {
    throw CreateError.InvalidParameters('Invalid development rewriting configuration');
  }
  if (
    developmentTenantRewriting.callbackStarts &&
    !redirectUrl.startsWith(developmentTenantRewriting.callbackStarts)
  ) {
    throw CreateError.InvalidParameters(
      `Unexpected callback for dev no-op rewriting: ${redirectUrl}, expected ${developmentTenantRewriting.callbackStarts}`
    );
  }
  const { _json: json } = profile;
  if (json.tid !== from.tenant) {
    throw CreateError.InvalidParameters(
      `Unexpected tenant for dev no-op rewriting: ${json.tid}, expected ${from.tenant}`
    );
  }
  json.tid = to.tenant;
  if (json.oid !== from.id) {
    throw CreateError.InvalidParameters(
      `Unexpected id for dev no-op rewriting: ${json.oid}, expected ${from.id}`
    );
  }
  profile.tenantId = to.tenant;
  json.oid = to.id;
  profile.oid = to.id;
  const jsonUsername = json.upn || json.preferred_username;
  if (jsonUsername !== from.upn) {
    throw CreateError.InvalidParameters(
      `Unexpected upn for dev no-op rewriting: ${jsonUsername}, expected ${from.upn}`
    );
  }
  profile.upn = to.upn;
  json.upn = to.upn;
  json.preferred_username = to.upn;
  (json as any).important_note =
    'This profile has been rewritten for development purposes, including oid, preferred_username, tid, upn.';
  profile._raw = JSON.stringify(json);
}
