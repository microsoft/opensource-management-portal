//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

import { Repository } from '../../business/index.js';
import { ReposAppRequest } from '../../interfaces/index.js';
import { jsonError } from '../../middleware/index.js';
import { getProviders } from '../../lib/transitional.js';
import JsonPager from './jsonPager.js';
import { ISearchReposOptions, RepositorySearchSortOrder, searchRepos } from './organization/repos.js';
import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment.js';

const router: Router = Router();

router.get('/', async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const providers = getProviders(req);
  const pager = new JsonPager<Repository>(req, res);
  let searchOptions: ISearchReposOptions = {
    q: (req.query.q || '') as string,
    type: (req.query.type || '') as string, // CONSIDER: TS: stronger typing
  };
  try {
    const companySpecificDeployment = getCompanySpecificDeployment();
    if (companySpecificDeployment?.features?.repositorySearch?.augmentSearchOptions) {
      searchOptions = await companySpecificDeployment.features.repositorySearch.augmentSearchOptions(
        providers,
        req,
        searchOptions
      );
    }
    const repos = await searchRepos(providers, null, RepositorySearchSortOrder.Updated, searchOptions);
    const slice = pager.slice(repos);
    return pager.sendJson(
      slice.map((repo) => {
        return repo.asJson();
      })
    );
  } catch (repoError) {
    console.dir(repoError);
    return next(jsonError(repoError));
  }
});

router.use('/*splat', (req, res: Response, next: NextFunction) => {
  return next(jsonError('no API or function available within this cross-organization repps list', 404));
});

export default router;
