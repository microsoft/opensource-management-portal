//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import express = require('express');
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { RequestWithSystemwidePermissions } from '../transitional';

import { ensureAllLinksInMemory, getAllLinksFromRequest } from '../middleware/business/allLinks';

const lowercaser = require('../middleware/lowercaser.js');

import { Operations } from '../business/operations';
import { MemberSearch } from '../business/memberSearch';
import { Team } from '../business/team';
import { TeamMember } from '../business/teamMember';
import { OrganizationMember } from '../business/organizationMember';

interface IPeopleSearchRequest extends RequestWithSystemwidePermissions {
  organization?: any;
  team2?: any;
  cachedLinks?: any;
  team2AddType?: any;
  team2RemoveType?: any;
  teamUrl?: any;
  teamPermissions?: any;
}

interface IOptionalFilter {
  filter?: string;
}

interface IGetPeopleResult {
  members?: OrganizationMember[];
  teamMembers?: TeamMember[];
}

router.use(asyncHandler(ensureAllLinksInMemory));

async function getPeople(operations: Operations, org: string | null, options, team2: Team): Promise<any> {
  // TODO: confirm the types returning
  // TODO: split out cross-org results and by-org results by diff. variable names
  let members;
  if (org) {
    const organization = operations.getOrganization(org);
    members = await organization.getMembers(options);
  } else {
    members = await operations.getMembers(options);
  }
  // const members = await operations.getMembers(org, options); // no more: ageInformation
  if (team2) {
    const teamMembers = await team2.getMembers();
    return { teamMembers, members }; // return callback(null, members, ageInformation, teamMembers);
  } else {
    return { members }; // return callback(null, members, ageInformation);
  }
}

router.get('/', lowercaser(['sort']), asyncHandler(async (req: IPeopleSearchRequest, res, next) => {
  const linksFromMiddleware = getAllLinksFromRequest(req);
  const operations = req.app.settings.operations as Operations;
  const org = req.organization ? req.organization.name : null;
  const isPortalSudoer = req.systemWidePermissions && req.systemWidePermissions.allowAdministration === true;
  let twoFactor = req.query.twoFactor;
  const team2 = req.team2 as Team;
  let options: IOptionalFilter = {};
  if (twoFactor === 'off') {
    options.filter = '2fa_disabled';
  }
  const { members, teamMembers } = await getPeople(operations, org, options, team2);
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
    links: linksFromMiddleware,
    getCorporateProfile: operations.mailAddressProvider.getCorporateEntry,

    // Used to filter team members in ./org/ORG/team/TEAM/members and other views
    teamMembers: teamMembers,

    // Whether this view is specific to an org or not
    isOrganizationScoped: !!org,

    // Used to enable the "add a member" or maintainer experience for teams
    team2AddType: req.team2AddType,
  });

  await search.search(page, req.query.sort);
  req.individualContext.webContext.render({
    view: 'people/',
    title: 'People',
    state: {
      search,
      filters,
      query: {
        phrase,
        twoFactor,
        type,
      },
      organization: req.organization || undefined,
      lightupSudoerLink: type === 'former' && isPortalSudoer,
      reposDataAgeInformation: null, // CUT: ageInformation,
      team2,
      team2AddType: req.team2AddType,
      team2RemoveType: req.team2RemoveType,
      teamUrl: req.teamUrl,
      specificTeamPermissions: req.teamPermissions,
    },
  });
}));

module.exports = router;
