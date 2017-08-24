//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const express = require('express');
const router = express.Router();
const lowercaser = require('../middleware/lowercaser.js');
const wrapError = require('../utils').wrapError;

const MemberSearch = require('../business/memberSearch');

function ensureLinks(req, res, next) {
  const operations = req.app.settings.operations;
  operations.getLinks((linksError, links) => {
    if (linksError) {
      linksError = wrapError(wrapError, 'There was a problem retrieving link information to display alongside members.');
    }
    req.cachedLinks = links;
    return next(linksError);
  });
}

router.use(ensureLinks);

function getPeople(operations, org, options, team2, callback) {
  operations.getMembers(org, options, (error, members, ageInformation) => {
    if (error) {
      return callback(error);
    }
    if (team2) {
      team2.getMembers((teamMembersError, teamMembers) => {
        if (teamMembersError) {
          return callback(teamMembersError);
        }
        return callback(null, members, ageInformation, teamMembers);
      });
    } else {
      return callback(null, members, ageInformation);
    }
  });
}

router.get('/', lowercaser(['sort']), (req, res, next) => {
  const operations = req.app.settings.operations;
  const org = req.organization ? req.organization.name : null;
  const isPortalSudoer = req.systemWidePermissions && req.systemWidePermissions.allowAdministration === true;
  let twoFactor = req.query.twoFactor;
  const team2 = req.team2;
  let options = {};
  if (twoFactor === 'off') {
    options.filter = '2fa_disabled';
  }
  getPeople(operations, org, options, team2, (error, members, ageInformation, teamMembers) => {
    if (error) {
      return next(error);
    }
    const page = req.query.page_number ? req.query.page_number : 1;
    let phrase = req.query.q;
    let type = req.query.type;
    if (type !== 'linked' && type!== 'active' && type !== 'unlinked' && type !== 'former' && type !== 'serviceAccount' && type !== 'unknownAccount') {
      type = null;
    }
    if (/*twoFactor !== 'on' && */twoFactor !== 'off') {
      twoFactor = null;
    }
    const filters = [];
    if (type) {
      filters.push({
        type: 'type',
        value: type,
        displayValue: type === 'former' ? 'formerly known' : type,
        displaySuffix: 'members',
      });
    }
    if (phrase) {
      filters.push({
        type: 'phrase',
        value: phrase,
        displayPrefix: 'matching',
      });
    }
    if (twoFactor) {
      filters.push({
        type: 'twoFactor',
        value: twoFactor,
        displayValue: twoFactor === 'on' ? 'secured' : 'without 2fa',
        // displayPrefix: 'matching',
      });
    }

    const search = new MemberSearch(members, {
      phrase: phrase,
      type: type,
      links: req.cachedLinks,
      getCorporateProfile: operations.mailAddressProvider.getCorporateEntry,

      // Used to filter team members in ./org/ORG/team/TEAM/members and other views
      teamMembers: teamMembers,

      // Used to enable the "add a member" or maintainer experience for teams
      team2AddType: req.team2AddType,
    });

    try {
      search.search(page, req.query.sort)
      .then(() => {
        req.legacyUserContext.render(req, res, 'people/', 'People', {
          search: search,
          filters: filters,
          query: {
            phrase: phrase,
            twoFactor: twoFactor,
            type: type,
          },
          organization: req.organization || undefined,
          lightupSudoerLink: type === 'former' && isPortalSudoer,
          reposDataAgeInformation: ageInformation,
          team2: team2,
          team2AddType: req.team2AddType,
          team2RemoveType: req.team2RemoveType,
          teamUrl: req.teamUrl,
          specificTeamPermissions: req.teamPermissions,
        });
      }).catch(next);
    } catch (initialError) {
      return next(initialError);
    }
  });
});

module.exports = router;
