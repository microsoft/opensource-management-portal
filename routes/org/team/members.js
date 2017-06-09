//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();
const teamAdminRequired = require('./teamAdminRequired');

function refreshMembers(team2, backgroundRefresh, maxSeconds, firstPageOnly, callback) {
  const options = {
    maxAgeSeconds: maxSeconds || 60,
    backgroundRefresh: backgroundRefresh,
  };
  if (firstPageOnly) {
    options.pageLimit = 1;
  }
  team2.getMembers(options, callback);
}

function refreshMembersAndSummary(team2, when, callback) {
  refreshMembers(team2, false /* immediately refresh */, when === 'now' ? -1 : null, true /* start with just the first page */, firstPageError => {
    refreshMembers(team2, false /* immediate */, when === 'now' ? -1 : null, false /* refresh all pages */, allPagesError => {
      return callback(firstPageError || allPagesError);
    });
  });
}

router.use((req, res, next) => {
  // Always make sure to have a relatively up-to-date membership cache available
  const team2 = req.team2;
  refreshMembers(team2, true /* background refresh ok */, null, false /* refresh all pages */, (error, members) => {
    req.refreshedMembers = members;
    return next(error);
  });
});

router.get('/refresh', (req, res, next) => {
  // Refresh all the pages and also the cached single-page view shown on the team page
  const team2 = req.team2;
  refreshMembersAndSummary(team2, 'whenever', error => {
    if (error) {
      return next(error);
    }
    return res.redirect(req.teamUrl);
  });
});

// Browse members
router.use('/browse', (req, res, next) => {
  req.team2RemoveType = 'member';
  return next();
}, require('../../peopleSearch'));

// Add org members to the team
router.use('/add', teamAdminRequired, (req, res, next) => {
  req.team2AddType = 'member';
  return next();
}, require('../../peopleSearch'));

router.post('/remove', teamAdminRequired, (req, res, next) => {
  const username = req.body.username;
  const team2 = req.team2;
  team2.removeMembership(username, removeError => {
    if (removeError) {
      return next(removeError);
    }
    req.legacyUserContext.saveUserAlert(req, username + ' has been removed from the team ' + team2.name + '.', 'Team membership update', 'success');
    refreshMembersAndSummary(team2, 'now', error => {
      if (error) {
        return next(error);
      }
      return res.redirect(req.teamUrl + 'members/browse/');
    });
  });
});

router.post('/add', teamAdminRequired, (req, res, next) => {
  const organization = req.organization;
  const team2 = req.team2;
  const refreshedMembers = req.refreshedMembers;
  const username = req.body.username;

  // Allow a one minute org cache for self-correcting validation
  const orgOptions = {
    maxAgeSeconds: 60,
    backgroundRefresh: true,
  };

  // Validate that the user is a current org member
  organization.getMembership(username, orgOptions, (error, membership) => {
    if (error || !membership) {
      if (error && error.innerError && error.innerError.code === 404) {
        error = new Error(`${username} is not a member of the organization and so cannot be added to the team until they have joined the org.`);
      }
      if (!membership && !error) {
        error = new Error('No membership information available for the user');
      }
      return next(error);
    }
    if (membership.state !== 'active') {
      return next(new Error(`${username} has the organization state of ${membership.state}. The user is not an active member and so cannot be added to the team at this time.`));
    }

    // Make sure they are not already a member
    const lc = username.toLowerCase();
    for (let i = 0; i < refreshedMembers.length; i++) {
      const member = refreshedMembers[i];
      if (member.login.toLowerCase() === lc) {
        return next(new Error(`The user ${username} is already a member of the team.`));
      }
    }

    team2.addMembership(username, error => {
      if (error) {
        return next(error);
      }
      req.legacyUserContext.saveUserAlert(req, `Added ${username} to the ${team2.name} team.`, 'Team membership update', 'success');
      refreshMembersAndSummary(team2, 'now', refreshError => {
        if (refreshError) {
          return next(refreshError);
        }
        return res.redirect(req.teamUrl + 'members/browse/');
      });
    });
  });
});

module.exports = router;
