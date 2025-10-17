//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import {
  Organization,
  MemberSearch,
  type CrossOrganizationMembersResult,
  Operations,
} from '../../business/index.js';
import { ReposAppRequest } from '../../interfaces/index.js';
import { CreateError, getProviders } from '../../lib/transitional.js';
import LeakyLocalCache, { getLinksLightCache } from './leakyLocalCache.js';

// BAD PRACTICE: leaky local cache
// CONSIDER: use a better approach
const leakyLocalCachePeople = new LeakyLocalCache<boolean, CrossOrganizationMembersResult>();

export async function getPeopleAcrossOrganizations(operations: Operations) {
  const value = leakyLocalCachePeople.get(true);
  if (value) {
    return { crossOrganizationMembers: value };
  }
  const crossOrganizationMembers = await operations.getMembers();
  leakyLocalCachePeople.set(true, crossOrganizationMembers);
  return { crossOrganizationMembers };
}

export async function equivalentLegacyPeopleSearch(req: ReposAppRequest) {
  const { operations } = getProviders(req);
  const links = await getLinksLightCache(operations);
  const orgId = req.organization ? (req.organization as Organization).id : null;
  const { crossOrganizationMembers } = await getPeopleAcrossOrganizations(operations);
  let page: number = 1;
  if (req.query.page_number !== undefined) {
    if (typeof req.query.page_number !== 'string') {
      throw CreateError.InvalidParameters('page_number must be a string');
    }
    page = parseInt(req.query.page_number, 10);
    if (isNaN(page) || page <= 0) {
      throw CreateError.InvalidParameters('page_number must be a positive number');
    }
  }
  let phrase: string;
  if (req.query.q !== undefined) {
    if (typeof req.query.q !== 'string') {
      throw CreateError.InvalidParameters('q must be a string');
    }
    phrase = req.query.q;
  }
  let type: string;
  if (req.query.type !== undefined) {
    if (typeof req.query.type !== 'string') {
      throw CreateError.InvalidParameters('type must be a string');
    }
    type = req.query.type;
  }
  if (req.query.sort !== undefined && typeof req.query.sort !== 'string') {
    throw CreateError.InvalidParameters('sort must be a string');
  }
  const sort = typeof req.query.sort === 'string' ? req.query.sort : null;
  const validTypes = new Set([
    'linked',
    'active',
    'unlinked',
    'former',
    'serviceAccount',
    'unknownAccount',
    'owners',
  ]);
  if (!validTypes.has(type)) {
    type = null;
  }
  const filters = [];
  if (type) {
    filters.push({
      type: 'type',
      value: type,
      displayValue: type === 'former' ? 'formerly known' : type,
      displaySuffix: 'members',
    });
  }
  if (phrase) {
    filters.push({
      type: 'phrase',
      value: phrase,
      displayPrefix: 'matching',
    });
  }
  const search = new MemberSearch({
    phrase,
    type,
    pageSize: 1000000, // we'll slice it locally
    links,
    providers: operations.providers,
    orgId,
    crossOrganizationMembers,
    isOrganizationScoped: false,
  });
  await search.search(page, sort);
  return search;
}
