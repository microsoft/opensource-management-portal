//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';

const router: Router = Router();

import { CreateError, getProviders } from '../lib/transitional.js';
import { RequestWithSystemwidePermissions, RequestTeamMemberAddType } from '../interfaces/index.js';
import { ensureAllLinksInMemory, getAllLinksFromRequest } from '../middleware/business/allLinks.js';

import { Operations, type CrossOrganizationMembersResult } from '../business/operations/index.js';
import { MemberSearch } from '../business/index.js';
import { Team } from '../business/index.js';
import { TeamMember } from '../business/index.js';
import { OrganizationMember } from '../business/index.js';
import { Organization } from '../business/index.js';

import lowercaser from '../middleware/lowercaser.js';

interface IPeopleSearchRequest extends RequestWithSystemwidePermissions {
  organization?: any;
  team2?: any;
  cachedLinks?: any;
  team2AddType?: RequestTeamMemberAddType;
  team2RemoveType?: any;
  teamUrl?: any;
  teamPermissions?: any;
}

interface IOptionalFilter {
  filter?: string;
}

interface IGetPeopleResult {
  organizationMembers?: OrganizationMember[];
  crossOrganizationMembers?: CrossOrganizationMembersResult;
  teamMembers?: TeamMember[];
}

router.use(ensureAllLinksInMemory);

async function getPeopleForOrganization(
  operations: Operations,
  org: string | null,
  options,
  team2: Team
): Promise<IGetPeopleResult> {
  const organization = operations.getOrganization(org);
  const organizationMembers = await organization.getMembers(options);
  if (team2) {
    const teamMembers = await team2.getMembers();
    return { teamMembers, organizationMembers };
  } else {
    return { organizationMembers };
  }
}

async function getPeopleAcrossOrganizations(
  operations: Operations,
  options,
  team2: Team
): Promise<IGetPeopleResult> {
  const crossOrganizationMembers = await operations.getMembers(options);
  if (team2) {
    const teamMembers = await team2.getMembers();
    return { teamMembers, crossOrganizationMembers };
  } else {
    return { crossOrganizationMembers };
  }
}

router.get(
  '/',
  lowercaser(['sort']),
  async (req: IPeopleSearchRequest, res: Response, next: NextFunction) => {
    const linksFromMiddleware = getAllLinksFromRequest(req);
    const { operations } = getProviders(req);
    const org = req.organization ? req.organization.name : null;
    const orgId = req.organization ? (req.organization as Organization).id : null;
    const isPortalSudoer =
      req.systemWidePermissions && req.systemWidePermissions.allowAdministration === true;
    let twoFactor = req.query.twoFactor;
    const team2 = req.team2 as Team;
    const options: IOptionalFilter = {};
    if (twoFactor === 'off') {
      options.filter = '2fa_disabled';
    }
    const { crossOrganizationMembers, organizationMembers, teamMembers } = org
      ? await getPeopleForOrganization(operations, org, options, team2)
      : await getPeopleAcrossOrganizations(operations, options, team2);
    let page = 1;
    if (req.query.page_number !== undefined) {
      if (typeof req.query.page_number !== 'string') {
        return next(CreateError.InvalidParameters('page_number must be a string'));
      }
      page = parseInt(req.query.page_number, 10);
      if (isNaN(page) || page <= 0) {
        return next(CreateError.InvalidParameters('page_number must be a positive number'));
      }
    }
    let pageSize: number;
    if (req.query.pageSize !== undefined) {
      if (typeof req.query.pageSize !== 'string') {
        return next(CreateError.InvalidParameters('pageSize must be a string'));
      }
      pageSize = req.query.pageSize ? Number(req.query.pageSize) : undefined;
      if (isNaN(pageSize) || pageSize <= 0) {
        return next(CreateError.InvalidParameters('pageSize must be a positive number'));
      }
    }
    if (req.query.sort !== undefined && typeof req.query.sort !== 'string') {
      return next(CreateError.InvalidParameters('sort must be a string'));
    }
    const sort = typeof req.query.sort === 'string' ? req.query.sort : null;
    if (req.query.q !== undefined && typeof req.query.q !== 'string') {
      return next(CreateError.InvalidParameters('q must be a string'));
    }
    const phrase = typeof req.query.q === 'string' ? req.query.q : null;
    let type: string;
    if (req.query.type !== undefined && typeof req.query.type !== 'string') {
      return next(CreateError.InvalidParameters('type must be a string'));
    }
    type = typeof req.query.type === 'string' ? req.query.type : null;
    const validTypes = new Set([
      'linked',
      'active',
      'unlinked',
      'former',
      'serviceAccount',
      'unknownAccount',
      'owners',
    ]);
    if (!validTypes.has(type)) {
      type = null;
    }
    if (/*twoFactor !== 'on' && */ twoFactor !== 'off') {
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
    const search = new MemberSearch({
      phrase,
      type,
      links: linksFromMiddleware,
      providers: operations.providers,
      orgId,
      pageSize,
      organizationMembers,
      crossOrganizationMembers,
      isOrganizationScoped: !!org, // Whether this view is specific to an org or not
      team2AddType: req.team2AddType, // Used to enable the "add a member" or maintainer experience for teams
      teamMembers, // Used to filter team members in ./org/ORG/team/TEAM/members and other views
    });

    await search.search(page, sort);
    let maillist = '';
    search.members.forEach(function (element) {
      if (maillist != '' && element.link != undefined) {
        maillist = maillist + ', ';
      }
      maillist += (element.link && element.link.corporateUsername) || '';
    });
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
          pageSize,
        },
        organization: req.organization || undefined,
        lightupSudoerLink: type === 'former' && isPortalSudoer,
        reposDataAgeInformation: null, // CUT: ageInformation,
        team2,
        team2AddType: req.team2AddType,
        team2RemoveType: req.team2RemoveType,
        teamUrl: req.teamUrl,
        specificTeamPermissions: req.teamPermissions,
        maillist,
        operations,
      },
    });
  }
);

export default router;
