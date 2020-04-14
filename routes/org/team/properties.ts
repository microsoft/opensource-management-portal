//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import { ReposAppRequest } from '../../../transitional';
import { wrapError } from '../../../utils';
const router = express.Router();
const teamAdminRequired = require('./teamAdminRequired');

interface IRequestWithTeamAndLegacy extends ReposAppRequest {
  team2?: any;
  teamUrl?: string;
}

router.get('/', teamAdminRequired, (req: IRequestWithTeamAndLegacy, res, next) => {
  const team2 = req.team2;
  team2.getDetails(error => {
    if (error) {
      return next(wrapError(error, 'Had trouble getting the detailed properties for this team.'));
    }
    req.individualContext.webContext.pushBreadcrumb('Properties');
    req.individualContext.webContext.render({
      view: 'org/team/properties',
      title: team2.name + ' - Properties',
      state: {
        team: team2,
        teamUrl: req.teamUrl,
      },
    });
  });
});

router.post('/', teamAdminRequired, (req: IRequestWithTeamAndLegacy, res, next) => {
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
    req.individualContext.webContext.saveUserAlert('Team properties updated on GitHub', 'Properties Saved', 'success');
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
