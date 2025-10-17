//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { corporateLinkToJson } from '../../business/index.js';
import { jsonError } from '../../middleware/index.js';
import { type GitHubSimpleAccount, type ICorporateLink, ReposAppRequest } from '../../interfaces/index.js';
import JsonPager from './jsonPager.js';
import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment.js';

import { getPerson as routeGetPerson } from './person.js';
import { equivalentLegacyPeopleSearch } from './peopleSearch.js';

const router: Router = Router();

const deployment = getCompanySpecificDeployment();
if (deployment?.routes?.api?.people) {
  deployment.routes.api.people(router);
}

export interface ICrossOrganizationMemberResponse {
  account: GitHubSimpleAccount;
  link?: ICorporateLink;
  organizations: string[];
}

export interface ICrossOrganizationSearchedMember {
  id: number;
  account: GitHubSimpleAccount;
  link?: ICorporateLink;
  orgs: IOrganizationMembershipAccount;
}

interface IOrganizationMembershipAccount {
  [id: string]: GitHubSimpleAccount;
}

router.get('/:login', routeGetPerson);

router.get('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const pager = new JsonPager<ICrossOrganizationSearchedMember>(req, res);
  try {
    const searcher = await equivalentLegacyPeopleSearch(req);
    const members = searcher.members as unknown as ICrossOrganizationSearchedMember[];
    const slice = pager.slice(members);
    return pager.sendJson(
      slice.map((xMember) => {
        const obj = Object.assign(
          {
            link: xMember.link ? corporateLinkToJson(xMember.link) : null,
            id: xMember.id,
            organizations: xMember.orgs ? Object.getOwnPropertyNames(xMember.orgs) : [],
          },
          xMember.account || { id: xMember.id }
        );
        return obj;
      })
    );
  } catch (repoError) {
    console.dir(repoError);
    return next(jsonError(repoError));
  }
});

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available within this cross-organization people list', 404));
});

export default router;
