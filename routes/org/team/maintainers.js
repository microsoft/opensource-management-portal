//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();
const teamAdminRequired = require('./teamAdminRequired');

function refreshMaintainers(team2, callback) {
  const options = {
    maxAgeSeconds: -1,
    backgroundRefresh: false,
  };
  team2.getMaintainers(options, callback);
}

router.use((req, res, next) => {
  // Get the latest maintainers with every request
  const team2 = req.team2;
  refreshMaintainers(team2, (error, maintainers) => {
    if (maintainers) {
      req.verifiedCurrentMaintainers = maintainers;
    }
    return next(error);
  });
});

router.get('/refresh', (req, res) => {
  // Since the views are cached, this can help resolve support situations before they start
  res.redirect(req.teamUrl);
});


router.post('/:id/downgrade', teamAdminRequired, (req, res, next) => {
  const team2 = req.team2;
  const id = req.params.id;
  const verifiedCurrentMaintainers = req.verifiedCurrentMaintainers;

  let maintainer = null;
  for (let i = 0; i < verifiedCurrentMaintainers.length; i++) {
    if (verifiedCurrentMaintainers[i].id == id /* less truthy, strings */) {
      maintainer = verifiedCurrentMaintainers[i];
      break;
    }
  }
  if (!maintainer) {
    return next(new Error(`The GitHub user with ID ${id} is not currently a maintainer of the team, so cannot be downgraded.`));
  }
  const username = maintainer.login;
  team2.addMembership(username, changeMembershipError => {
    if (changeMembershipError) {
      return next(changeMembershipError);
    }
    req.legacyUserContext.saveUserAlert(req, `Downgraded ${username} from a team maintainer to a team member`, team2.name + ' membership updated', 'success');
    refreshMaintainers(team2, refreshError => {
      if (refreshError) {
        return next(refreshError);
      }
      res.redirect(req.teamUrl);
    });
  });
});

router.use('/add', teamAdminRequired, (req, res, next) => {
  req.team2AddType = 'maintainer';
  return next();
});

router.post('/add', teamAdminRequired, function (req, res, next) {
  const team2 = req.team2;
  const login = req.body.username;
  team2.addMaintainer(login, (addMaintainerError) => {
    if (addMaintainerError) {
      return next(addMaintainerError);
    }
    req.legacyUserContext.saveUserAlert(req, `Added ${login} as a team maintainer`, team2.name + ' membership updated', 'success');
    refreshMaintainers(team2, refreshError => {
      if (refreshError) {
        return next(refreshError);
      }
      return res.redirect(req.teamUrl);
    });
  });
});

router.use('/add', require('../../peopleSearch'));

module.exports = router;
