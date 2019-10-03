//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import _ from 'lodash';

import async = require('async');
import Q from 'q';
import { ICorporateLink } from './corporateLink';
import { OrganizationMember } from './organizationMember';
import { ICrossOrganizationMembersResult } from './operations';

const earlyProfileFetchTypes = new Set(['former', 'active', 'serviceAccount', 'unknownAccount']);

const defaultPageSize = 33; // GitHub.com seems to use a value around 33

export class MemberSearch {
  public members: any[];
  public links: ICorporateLink[];
  public getCorporateProfile: any;
  public teamMembers: any;
  public team2AddType: any;
  public pageSize: number;
  public phrase: string;
  public type: string;
  public page: number;
  public sort: string;
  public totalPages: number;
  public totalItems: number;
  public pageFirstItem: number;
  public pageLastItem: number;

  constructor(members: ICrossOrganizationMembersResult | OrganizationMember[], options) {
    options = options || {};
    // must be a Map from ID to object with { orgs, memberships, account }
    if (Array.isArray(members)) {
      this.members = members;
    } else {
      if (!members || !members.values || !members.set) {
        throw new Error('Members must be a Map.');
      }
      this.members = Array.from(members.values());
    }
    translateMembers(this.members, options.isOrganizationScoped, options.links);
    this.links = options.links;
    this.getCorporateProfile = options.getCorporateProfile;
    this.teamMembers = options.teamMembers;
    this.team2AddType = options.team2AddType;

    this.pageSize = options.pageSize || defaultPageSize;

    this.phrase = options.phrase;
    this.type = options.type;
  }

  search(page, sort?: string) {
    const self = this;
    self.page = parseInt(page);
    self.sort = sort ? sort.charAt(0).toUpperCase() + sort.slice(1) : 'Alphabet';

    return Q.all(
      self.filterByTeamMembers()
          .associateLinks()
          .getCorporateProfilesEarly(self.type)
          .then(() => {
            return self.filterByType(self.type)
                      .filterByPhrase(self.phrase)
                      .determinePages()['sortBy' + self.sort]()
                      .getPage(self.page)
                      .sortOrganizations()
                      .getCorporateProfiles();
          }));
  }

  filterByTeamMembers() {
    // If this is a sub-team view, filter by members unless the
    // special "add a member" experience is present in this route.
    let teamSet = new Set();
    if (this.teamMembers) {
      for (let i = 0; i < this.teamMembers.length; i++) {
        const member = this.teamMembers[i];
        teamSet.add(member.id);
      }
      if (this.team2AddType) {
        for (let i = 0; i < this.members.length; i++) {
          const member = this.members[i];
          member.isTeamMember = teamSet.has(member.id);
        }
      } else {
        this.members = this.members.filter(m => { return teamSet.has(m.id); });
      }
    }
    return this;
  }

  getCorporateProfilesEarly(type) {
    // This will make a Redis call for every single member, if not cached,
    // so the early mode is only used in a specific type of view this early.
    // The default just resolves for a single page of people.
    if (!earlyProfileFetchTypes.has(type)) {
      return Q(this);
    }
    return this.getCorporateProfiles();
  }

  associateLinks() {
    const links = new Map();
    this.links.forEach(link => {
      const id = parseInt(link.thirdPartyId, 10);
      links.set(id, link);
    });
    this.members.forEach(member => {
      const link = links.get(member.id);
      if (link) {
        member.link = link;
      }
    });
    return this;
  }

  sortOrganizations() {
    this.members.forEach(member => {
      if (member.orgs && member.orgs.length > 0) {
        member.orgs = _.sortBy(member.orgs, ['name']);
      }
    });
    return this;
  }

  getCorporateProfiles() {
    if (this.getCorporateProfile) {
      const resolveProfiles = [];
      this.members.forEach(member => {
        resolveProfiles.push(getProfile(this.type, this.getCorporateProfile, member));
      });
      return Q.all(resolveProfiles).then(values => {
        return Q(this);
      });
    }
    return Q(this);
  }

  determinePages() {
    this.totalPages = Math.ceil(this.members.length / this.pageSize);
    this.totalItems = this.members.length;
    return this;
  }

  getPage(page) {
    this.members = this.members.slice((page - 1) * this.pageSize, ((page - 1) * this.pageSize) + this.pageSize);
    this.pageFirstItem = 1 + ((page - 1) * this.pageSize);
    this.pageLastItem = this.pageFirstItem + this.members.length - 1;
    return this;
  }

  filterByPhrase(phrase) {
    if (phrase) {
      phrase = phrase.toLowerCase();
      this.members = this.members.filter(m => { return memberMatchesPhrase(m, phrase); });
    }
    return this;
  }

  filterByType(type) {
    let filter = null;
    switch (type) {
    case 'linked':
      filter = r => { return r.link && r.link.thirdPartyId; };
      break;
    case 'unlinked':
      filter = r => { return !r.link; };
      break;
    case 'unknownAccount':
      filter = r => { return r.link && r.link.thirdPartyId && (!r.corporate || !r.corporate.userPrincipalName); };
      break;
    case 'former':
      filter = r => { return r.link && r.link.thirdPartyId && !r.link.serviceAccount && (!r.corporate || !r.corporate.userPrincipalName); };
      break;
    case 'active':
      filter = r => { return r.link && r.link.thirdPartyId && r.link.corporateId && !r.link.serviceAccount && r.corporate && r.corporate.userPrincipalName; };
      break;
    case 'serviceAccount':
      filter = r => { return r.link && r.link.serviceAccount; };
      break;
    }
    if (filter) {
      this.members = this.members.filter(filter);
    }
    return this;
  }

  sortByAlphabet() {
    this.members.sort((a, b) => {
      const aAccountIdentity = a.login ? a.login.toLowerCase() : a.account.login.toLowerCase();
      const bAccountIdentity = b.login ? b.login.toLowerCase() : b.account.login.toLowerCase();
      if (aAccountIdentity > bAccountIdentity) return 1;
      if (aAccountIdentity < bAccountIdentity) return -1;
      return 0;
    });
    return this;
  }
}

function translateMembers(members, isOrganizationScoped, optionalLinks) {
  // Support showing
  const linkedNoOrg = new Map();
  if (!isOrganizationScoped && optionalLinks) {
    for (let i = 0; i < optionalLinks.length; i++) {
      const link = optionalLinks[i] as ICorporateLink;
      if (link && link.thirdPartyUsername && link.thirdPartyId) {
        const id = parseInt(link.thirdPartyId, 10);
        linkedNoOrg.set(id, link);
      }
    }
  }
  // A breaking change altered the projected format
  members.forEach(member => {
    linkedNoOrg.delete(member.id);
    if (member.orgs && !member.account) {
      const orgNames = Object.getOwnPropertyNames(member.orgs);
      const firstOrganization = orgNames[0];
      member.account = member.orgs[firstOrganization];
    }
  });
  // Locate linked users with no org memberships
  if (linkedNoOrg.size) {
    const noOrgs = Array.from(linkedNoOrg.values());
    for (let i = 0; i < noOrgs.length; i++) {
      const n = noOrgs[i];
      const thirdPartyId = n.thirdPartyId /* new link objects */ || n.ghid /* old implementation */;
      const thirdPartyUsername = (n.thirdPartyUsername || n.ghu || '').toLowerCase();
      const thirdPartyAvatar = n.thirdPartyAvatar || n.ghavatar;
      const id = parseInt(thirdPartyId, 10);
      const newMember = {
        account: {
          avatar_url: thirdPartyAvatar,
          id,
          login: thirdPartyUsername || null,
        },
        id,
        orgs: {},
      };
      // Create a member entry
      members.push(newMember);
    }
  }
}

function tryGetCorporateProfile(upn, oid, getCorporateProfile, callback) {
  let profile = null;
  function getCorporateProfileByMethod(hashKey, field, next) {
    getCorporateProfile(hashKey, field, hashKey === 'upns' /* JSON */, (error, p) => {
      if (error) {
        error = null; // ignore any issue with the specific lookup
      } else if (p && hashKey !== 'upns') {
        const newUpn = p;
        return getCorporateProfileByMethod('upns', newUpn, next);
      } else if (p) {
        profile = p;
        error = true; // shortcut the waterfall
      }
      next(error);
    });
  }
  function getByOid(next) {
    getCorporateProfileByMethod('aadIds', oid, next);
  }
  function getByUpn(next) {
    getCorporateProfileByMethod('upns', upn, next);
  }
  function getByUpnWithEmail(next) {
    getCorporateProfileByMethod('emailAddresses', upn, next);
  }
  const tasks = [];
  if (upn) {
    tasks.push(getByUpn); // most efficient
  }
  if (oid) {
    tasks.push(getByOid); // most accurate
  }
  if (upn) {
    tasks.push(getByUpnWithEmail); // common fallback
  }
  async.waterfall(tasks, () => {
    return callback(null, profile);
  });
}

function getProfile(filterType, getCorporateProfile, member) {
  const deferred = Q.defer();
  const projectLinkAsCorporateProfile = filterType !== 'former';
  const link = member.link as ICorporateLink;
  const upn = link ? link.corporateUsername : null;
  const oid = link ? link.corporateId : null;
  if (!upn && !oid) {
    deferred.resolve();
  } else {
    if (member.corporate) {
      deferred.resolve(member.corporate);
    } else {
      tryGetCorporateProfile(upn, oid, getCorporateProfile, (error, profile) => {
        if (error) {
          return deferred.reject(error);
        }
        if (!profile && projectLinkAsCorporateProfile) {
          profile = {
            preferredName: (member.link as ICorporateLink).corporateUsername,
            userPrincipalName: upn,
            aadId: oid,
          };
        }
        if (profile) {
          member.corporate = profile;
        }
        deferred.resolve();
      });
    }
  }
  return deferred.promise;
}

function memberMatchesPhrase(member, phrase) {
  const link = member.link as ICorporateLink;
  let linkIdentity = link ? `${link.corporateUsername} ${link.corporateDisplayName} ${link.thirdPartyUsername} ${link.thirdPartyId} ` : '';
  let accountIdentity = member.login ? member.login.toLowerCase() : member.account.login.toLowerCase();
  let combined = (linkIdentity + accountIdentity).toLowerCase();
  return combined.includes(phrase);
}
