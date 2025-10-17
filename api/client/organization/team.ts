//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { getContextualTeam } from '../../../middleware/github/teamPermissions.js';
import { jsonError } from '../../../middleware/index.js';
import { getProviders } from '../../../lib/transitional.js';
import JsonPager from '../jsonPager.js';
import { getLinksLightCache } from '../leakyLocalCache.js';
import { equivalentLegacyPeopleSearch } from './people.js';
import {
  TeamRepositoryPermission,
  OrganizationMember,
  corporateLinkToJson,
} from '../../../business/index.js';
import {
  ReposAppRequest,
  TeamJsonFormat,
  NoCacheNoBackground,
  ICorporateLink,
} from '../../../interfaces/index.js';
import { sortRepositoriesByNameCaseInsensitive } from '../../../lib/utils.js';
import getCompanySpecificDeployment from '../../../middleware/companySpecificDeployment.js';

const router: Router = Router();

router.get('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const providers = getProviders(req);
  const team = getContextualTeam(req);
  const format = TeamJsonFormat.Augmented; // includes corporateMetadata
  let json = team.asJson(format);
  const companySpecific = getCompanySpecificDeployment();
  if (companySpecific?.features?.augmentApiMetadata?.augmentTeamClientJson) {
    json = await companySpecific.features.augmentApiMetadata.augmentTeamClientJson(
      providers,
      team,
      json,
      format
    );
  }
  return res.json(json) as unknown as void;
});

router.get('/repos', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  try {
    const forceRefresh = !!req.query.refresh;
    const pager = new JsonPager<TeamRepositoryPermission>(req, res);
    const team = getContextualTeam(req);
    // const onlySourceRepositories = {
    //   type: GitHubRepositoryType.,
    // };
    let reposWithPermissions = null;
    const cacheOptions = forceRefresh ? NoCacheNoBackground : undefined;
    reposWithPermissions = await team.getRepositories(cacheOptions);
    const repositories = reposWithPermissions.sort(sortRepositoriesByNameCaseInsensitive);
    const slice = pager.slice(repositories);
    return pager.sendJson(
      slice.map((rp) => {
        return rp.asJson();
      })
    );
  } catch (repoError) {
    console.dir(repoError);
    return next(jsonError(repoError));
  }
});

router.get('/members', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  try {
    const forceRefresh = !!req.query.refresh;
    const team = getContextualTeam(req);
    const pager = new JsonPager<OrganizationMember>(req, res); // or Org Member?
    const searcher = await equivalentLegacyPeopleSearch(req, { team, forceRefresh });
    const members = searcher.members;
    const slice = pager.slice(members);
    return pager.sendJson(
      slice.map((organizationMember) => {
        const obj = Object.assign(
          {
            link: organizationMember.link ? corporateLinkToJson(organizationMember.link) : null,
          },
          organizationMember.getEntity()
        );
        return obj;
      })
    );
  } catch (error) {
    console.dir(error);
    return next(jsonError(error));
  }
});

router.get('/maintainers', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const { operations } = getProviders(req);
  try {
    const forceRefresh = !!req.query.refresh;
    const team = getContextualTeam(req);
    const links = await getLinksLightCache(operations);
    const cacheOptions = forceRefresh ? NoCacheNoBackground : undefined;
    const maintainers = await team.getMaintainers(cacheOptions);
    const idSet = new Set<number>();
    maintainers.forEach((maintainer) => idSet.add(Number(maintainer.id)));
    const ls = new Map<number, ICorporateLink>();
    links.forEach((link) => {
      if (idSet.has(Number(link.thirdPartyId))) {
        ls.set(Number(link.thirdPartyId), link);
      }
    });
    return res.json(
      maintainers.map((maintainer) => {
        return {
          member: maintainer.asJson(),
          isSystemAccount: operations.isSystemAccountByUsername(maintainer.login),
          link: corporateLinkToJson(ls.get(Number(maintainer.id))),
        };
      })
    ) as unknown as void;
  } catch (error) {
    return next(error);
  }
});

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available for this specific team', 404));
});

export default router;
