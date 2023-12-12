//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import { corporateLinkToJson } from '../../business';
import { jsonError } from '../../middleware';
import { type GitHubSimpleAccount, type ICorporateLink, ReposAppRequest } from '../../interfaces';
import JsonPager from './jsonPager';
import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment';

import { getPerson as routeGetPerson } from './person';
import { equivalentLegacyPeopleSearch } from './peopleSearch';

const router: Router = Router();

const deployment = getCompanySpecificDeployment();
deployment?.routes?.api?.people && deployment.routes.api.people(router);

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

router.get(
  '/',
  asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
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
  })
);

router.use('*', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available within this cross-organization people list', 404));
});

export default router;
