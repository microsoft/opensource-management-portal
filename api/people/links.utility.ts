//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { MemberSearch } from '../../business/memberSearch.js';
import { CrossOrganizationMembersResult, Operations } from '../../business/operations/index.js';
import { wrapError } from '../../lib/utils.js';
import { jsonError } from '../../middleware/jsonError.js';

import type { ICorporateLink } from '../../interfaces/link.js';

// prettier-ignore
export const unsupportedApiVersions = [
  '2016-12-01',
];

// prettier-ignore
export const extendedLinkApiVersions = [
  '2019-02-01',
];

export async function getAllUsers(
  apiVersion: string,
  operations: Operations,
  skipOrganizations: boolean,
  showTimestamps: boolean,
  showLinkIds?: boolean
): Promise<any[]> {
  let links: ICorporateLink[] = null;
  try {
    links = await operations.getLinks();
  } catch (linksError) {
    linksError = wrapError(
      linksError,
      'There was a problem retrieving link information to display alongside members.'
    );
    throw jsonError(linksError, 500);
  }
  let crossOrganizationMembers: CrossOrganizationMembersResult;
  try {
    // TODO: this is a cross-org map!? validate return type...
    crossOrganizationMembers = await operations.getMembers();
  } catch (error) {
    error = wrapError(error, 'There was a problem getting the members list.');
    throw jsonError(error, 500);
  }
  const search = new MemberSearch({
    crossOrganizationMembers,
    type: 'linked',
    links,
    providers: operations.providers,
    pageSize: Number.MAX_SAFE_INTEGER,
  });
  try {
    await search.search(1);
    const sr = search.members;
    const isExpandedView = extendedLinkApiVersions.includes(apiVersion);
    const results = [];
    sr.forEach((member) => {
      const entry = {
        github: {
          id: member['account'].id,
          login: member['account'].login,
          organizations: undefined,
        },
        isServiceAccount: undefined,
        serviceAccountContact: undefined,
      };
      if (isExpandedView) {
        entry.github['avatar'] = member['account'].avatar_url;
      }
      if (showLinkIds && member && member.link && member.link['id']) {
        entry['id'] = member.link['id'];
      }
      if (!skipOrganizations && member['orgs']) {
        entry.github.organizations = Object.getOwnPropertyNames(member['orgs']);
      }
      // '2017-09-01' added 'isServiceAccount'; so '2016-12-01' & '2017-03-08' do not have it
      const link = member.link as ICorporateLink;
      if (showTimestamps && link && link['created']) {
        entry['timestamp'] = link['created'];
      }
      if (
        link &&
        link.isServiceAccount === true &&
        apiVersion !== '2016-12-01' &&
        apiVersion !== '2017-03-08'
      ) {
        entry.isServiceAccount = true;
        if (isExpandedView && link.isServiceAccount && link.serviceAccountMail) {
          entry.serviceAccountContact = link.serviceAccountMail;
        }
      }
      const corporate = member.link;
      if (corporate) {
        const corporatePropertyName = apiVersion === '2016-12-01' ? 'corporate' : 'aad'; // This was renamed to be provider name-based
        entry[corporatePropertyName] = {
          alias: corporate.corporateAlias,
          preferredName: corporate.corporateDisplayName,
          userPrincipalName: corporate.corporateUsername,
          emailAddress: corporate.corporateMailAddress,
        };
        const corporateIdPropertyName = apiVersion === '2016-12-01' ? 'aadId' : 'id'; // Now just 'id'
        entry[corporatePropertyName][corporateIdPropertyName] = corporate.corporateId;
      }
      results.push(entry);
    });
    return results;
  } catch (error) {
    throw jsonError(error, 400);
  }
}
