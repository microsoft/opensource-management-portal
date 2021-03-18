//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import asyncHandler from 'express-async-handler';

import { IndividualContext } from '../../user';
import LeakyLocalCache, { getLinksLightCache } from './leakyLocalCache';
import { corporateLinkToJson, ICorporateLink, ICrossOrganizationMembersResult, MemberSearch, Operations, Organization } from '../../business';
import { jsonError } from '../../middleware';
import { ReposAppRequest, IProviders } from '../../transitional';
import JsonPager from './jsonPager';
import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment';

import RouteGetPerson from './person';

const router = express.Router();

const deployment = getCompanySpecificDeployment();

// BAD PRACTICE: leaky local cache
// CONSIDER: use a better approach
const leakyLocalCachePeople = new LeakyLocalCache<boolean, ICrossOrganizationMembersResult>();

async function getPeopleAcrossOrganizations(operations: Operations) {
  const value = leakyLocalCachePeople.get(true);
  if (value) {
    return { crossOrganizationMembers: value };
  }
  const crossOrganizationMembers = await operations.getMembers();
  leakyLocalCachePeople.set(true, crossOrganizationMembers);
  return { crossOrganizationMembers };
}

export async function equivalentLegacyPeopleSearch(req: ReposAppRequest) {
  const { operations } = req.app.settings.providers as IProviders;
  const links = await getLinksLightCache(operations);
  const org = req.organization ? req.organization.name : null;
  const orgId = req.organization ? (req.organization as Organization).id : null;
  const { crossOrganizationMembers } = await getPeopleAcrossOrganizations(operations);
  const page = req.query.page_number ? Number(req.query.page_number) : 1;
  let phrase = req.query.q as string;
  let type = req.query.type as string;
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
  await search.search(page, req.query.sort as string);
  return search;
}

interface ISimpleAccount {
  login: string;
  avatar_url: string;
  id: number;
}

export interface ICrossOrganizationMemberResponse {
  account: ISimpleAccount;
  link?: ICorporateLink;
  organizations: string[];
}

export interface ICrossOrganizationSearchedMember {
  id: number;
  account: ISimpleAccount;
  link?: ICorporateLink;
  orgs: IOrganizationMembershipAccount;
}

interface IOrganizationMembershipAccount {
  [id: string]: ISimpleAccount;
}

router.get('/:login', RouteGetPerson);

router.get('/', asyncHandler(async (req: ReposAppRequest, res, next) => {
  const pager = new JsonPager<ICrossOrganizationSearchedMember>(req, res);
  try {
    const searcher = await equivalentLegacyPeopleSearch(req);
    const members = searcher.members as unknown as ICrossOrganizationSearchedMember[];
    const slice = pager.slice(members);
    return pager.sendJson(slice.map(xMember => {
        const obj = Object.assign({
          link: xMember.link ? corporateLinkToJson(xMember.link) : null,
          id: xMember.id,
          organizations: xMember.orgs ? Object.getOwnPropertyNames(xMember.orgs) : [],
        }, xMember.account || { id: xMember.id });
        return obj;
      }),
    );
  } catch (repoError) {
    console.dir(repoError);
    return next(jsonError(repoError));
  }
}));

router.use('*', (req, res, next) => {
  return next(jsonError('no API or function available within this cross-organization people list', 404));
});

export default router;
