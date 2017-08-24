//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();
const teamAdminRequired = require('./teamAdminRequired');
const utils = require('../../../utils');

router.get('/', teamAdminRequired, (req, res, next) => {
  const team2 = req.team2;
  team2.getDetails(error => {
    if (error) {
      return next(utils.wrapError(error, 'Had trouble getting the detailed properties for this team.'));
    }
    req.legacyUserContext.addBreadcrumb(req, 'Properties');
    req.legacyUserContext.render(req, res, 'org/team/properties', team2.name + ' - Properties', {
      team: team2,
      teamUrl: req.teamUrl,
    });
  });
});

router.post('/', teamAdminRequired, (req, res, next) => {
  const team2 = req.team2;
  const organization = req.organization;
  const patch = {
    name: req.body.ghname,
    description: req.body.description,
  };
  team2.edit(patch, error => {
    if (error) {
      return next(error);
    }
    req.legacyUserContext.saveUserAlert(req, 'Team properties updated on GitHub', 'Properties Saved', 'success');
    team2.getDetails(getDetailsError => {
      if (getDetailsError) {
        return next(getDetailsError);
      }
      const slug = team2.slug;
      return res.redirect('/' + organization.name + '/teams/' + slug);
    });
  });
});

module.exports = router;
