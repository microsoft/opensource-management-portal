//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express = require('express');
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { IProviders, CreateError } from '../transitional';
import PublicReposFastFilter from '../features/publicReposFastFilter';
import { Repository } from '../business/repository';

const symbolFastFilter = Symbol('FastFilter');
const DefaultPageSize = 40;
const MaxPageSize = 100;

router.use((req, res, next) => {
  const { config } = req.app.settings.providers as IProviders;
  if (config.api?.flags?.publicReposFilter !== true) {
    return next(CreateError.InvalidParameters('Public repos API not available'));
  }
  return next();
});

router.get('/', asyncHandler(async function (req, res, next) {
  const providers = req.app.settings.providers;
  let filterProvider = providers[symbolFastFilter] as PublicReposFastFilter;

  const pageSize = Math.min(req.query.ps ? parseInt(req.query.ps as string, 10) : DefaultPageSize, MaxPageSize);

  if (!filterProvider || !filterProvider.isInitialized) {
    filterProvider = new PublicReposFastFilter(providers);
    await filterProvider.initialize();
    providers[symbolFastFilter] = filterProvider;
  }

  let page = req.query.page ? parseInt(req.query.page as string, 10) : 0;
  if (Number.isNaN(page) || page < 0) {
    return next(CreateError.InvalidParameters('Invalid page'));
  }

  let search = req.query.q ? (req.query.q as string).toLowerCase() : null;

  let repos = filterProvider.repositories;

  // filter
  if (search) {
    repos = repos.filter(repo => {
      const fn = repo.full_name || '';
      const d = repo.description || '';
      const w = repo.homepage || '';
      return fn.toLowerCase().includes(search) || d.toLowerCase().includes(search) || w.toLowerCase().includes(search);
    });
  }

  const totalPages = Math.round(Math.floor((repos.length / pageSize) + 1)) - 1;
  page = Math.min(totalPages, page);

  // sort
  repos = repos.sort(Repository.SortByAwesomeness);

  // paginate
  let selectedRepos = repos.slice(page * pageSize, pageSize + (pageSize * page));
  const propertiesToClone = [
    'name',
    'id',
    'description',
    'html_url',
    'full_name',
    'fork',
    'homepage',
    'forks_count',
    'stargazers_count',
    'open_issues_count',
    'pushed_at',
    'updated_at',
    'created_at',
    'language',
  ];
  let displayRepos = selectedRepos.map(repo => {
    const clone = {};
    for (const key of propertiesToClone) {
      clone[key] = repo[key];
    }
    return clone;
  });

  return res.json({
    page,
    totalPages,
    repos: displayRepos,
  });
}));


router.use((err, req, res, next) => {
  if (err && err['json']) {
    // jsonError objects should bubble up like before
    return next(err);
  }
  // If any errors happened in the API routes that did not send a jsonError,
  // just return as a JSON error and end here.
  if (err && err['status']) {
    res.status(err['status']);
  } else {
    res.status(500);
  }
  res.json({
    message: err && err.message ? err.message : 'Error',
  });
  const providers = req.app.settings.providers as IProviders;
  if (providers && providers.insights) {
    providers.insights.trackException({ exception: err });
  }
});

export default router;

