//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const express = require('express');
const router = express.Router();
const utils = require('../../../../utils');

const collaboratorsRoute = require('./collaborators');

// ----------------------------------------------------------------------------
// Repo rename, description and optional URL changes. Almost the same code path
// as the "visibility swap" code.
// ----------------------------------------------------------------------------
router.get('/properties', function (req, res) {
  req.oss.addBreadcrumb(req, 'Properties');
  req.oss.render(req, res, 'org/team/repos/properties', req.repo.full_name + ' - Repository Properties', {
    team: req.team,
    repo: req.repo,
  });
});

router.post('/properties', function (req, res, next) {
  req.repo.update({
    name: req.body.name === '' ? undefined : req.body.name,
    homepage: req.body.homepage === '' ? undefined : req.body.homepage,
    description: req.body.description === '' ? undefined : req.body.description,
  }, function (error) {
    if (error) {
      return next(utils.wrapError(error, 'There was a problem updating the properties for the repo. If you tried renaming the repo, was it legitimate? Please contact the admins.'));
    }
    res.redirect(req.teamReposUrl);
  });
});

// ----------------------------------------------------------------------------
// Swap visibility
// ----------------------------------------------------------------------------
router.get('/visibility/swap', function (req, res) {
  var team = req.team;
  var repo = req.repo;
  var oss = req.oss;
  oss.addBreadcrumb(req, 'Repository Visibility');
  oss.render(req, res, 'org/team/repos/goPublic', repo.full_name + ' - Visibility Settings', {
    team: team,
    repo: repo,
  });
});

router.post('/visibility/swap', function (req, res, next) {
  var repo = req.repo;
  repo.update({
    private: false,
    homepage: req.body.homepage === '' ? undefined : req.body.homepage,
    description: req.body.description === '' ? undefined : req.body.description,
  }, function (error) {
    if (error) {
      return next(utils.wrapError(error, 'There was a problem going public. Please contact the admins.'));
    }
    res.redirect(req.teamReposUrl);
  });
});

// ----------------------------------------------------------------------------
// Delete (destroy permanently) a repo
// ----------------------------------------------------------------------------
router.get('/delete', function (req, res) {
  var team = req.team;
  var repo = req.repo;
  req.oss.addBreadcrumb(req, 'Permanent Delete');
  req.oss.render(req, res, 'org/team/repos/delete', repo.full_name + ' - Delete', {
    team: team,
    repo: repo,
  });
});

router.post('/delete', function (req, res, next) {
  var repo = req.repo;
  repo.delete(function (error) {
    if (error) {
      return next(utils.wrapError(error, 'There was a problem deleting the repo according to the GitHub API. Please contact the admins.'));
    }
    res.redirect(req.teamReposUrl);
  });
});

router.use('/collaborators', collaboratorsRoute);

module.exports = router;
