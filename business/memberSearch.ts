//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import _ from 'lodash';

import { ICorporateLink } from './corporateLink';
import { OrganizationMember } from './organizationMember';
import { ICrossOrganizationMembersResult } from './operations';
import { IProviders } from '../transitional';

const earlyProfileFetchTypes = new Set(['former', 'active', 'serviceAccount', 'unknownAccount']);

const defaultPageSize = 33; // GitHub.com seems to use a value around 33
const earlyFetchPageBreak = 200;

interface ICorporateProfile {
  corporateDisplayName?: string;
  corporateId?: string;
  corporateUsername?: string;
  alias?: string;
  emailAddress?: string;
}

export class MemberSearch {
  #providers: IProviders;

  public members: any[];
  public links: ICorporateLink[];
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
    this.#providers = options.providers as IProviders;
    this.teamMembers = options.teamMembers;
    this.team2AddType = options.team2AddType;

    this.pageSize = options.pageSize || defaultPageSize;

    this.phrase = options.phrase;
    this.type = options.type;
  }

  async search(page, sort?: string): Promise<void> {
    this.page = parseInt(page);
    this.sort = sort ? sort.charAt(0).toUpperCase() + sort.slice(1) : 'Alphabet';

    await this
      .filterByTeamMembers()
      .associateLinks()
      .getCorporateProfilesEarly(this.type);
    return this
      .filterByType(this.type)
      .filterByPhrase(this.phrase)
      .determinePages()['sortBy' + this.sort]()
      .getPage(this.page)
      .sortOrganizations()
      .getCorporateProfiles();
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

  async getCorporateProfilesEarly(type): Promise<MemberSearch> {
    // This will make a Redis call for every single member, if not cached,
    // so the early mode is only used in a specific type of view this early.
    // The default just resolves for a single page of people.
    if (this.pageSize > earlyFetchPageBreak || earlyProfileFetchTypes.has(type)) {
      return await this.getCorporateProfiles();
    }
    return this;
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

  async getCorporateProfiles(): Promise<MemberSearch> {
    if (this.#providers && this.#providers.corporateContactProvider) {
      const corporateContactProvider = this.#providers.corporateContactProvider;
      let bulk = new Map();
      if (this.pageSize > earlyFetchPageBreak) {
        try {
          bulk = await corporateContactProvider.getBulkCachedContacts();
        } catch (bulkReadError) {
          console.warn(bulkReadError);
        }
      }
      const projectLinkAsCorporateProfile = this.type !== 'former';
      for (const member of this.members) {
        if (member.corporate) {
          continue;
        }
        const link = member.link as ICorporateLink;
        const corporateUsername = link ? link.corporateUsername : null;
        if (!corporateUsername) {
          continue;
        }
        try {
          const contacts = bulk.get(corporateUsername) || await corporateContactProvider.lookupContacts(corporateUsername);
          if (contacts) {
            const profile: ICorporateProfile = {
              corporateDisplayName: link?.corporateDisplayName,
              corporateId: link?.corporateId,
              corporateUsername: link?.corporateUsername,
              alias: contacts.alias,
              emailAddress: contacts.emailAddress,
            };
            member.corporate = profile;
          } else if (projectLinkAsCorporateProfile) {
            member.corporate = link;
          }
        } catch (lookupError) {
          console.dir(lookupError);
        }
      }
    }
    return this;
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
      filter = r => { return r.link && r.link.isServiceAccount; };
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

function memberMatchesPhrase(member, phrase) {
  const link = member.link as ICorporateLink;
  let linkIdentity = link ? `${link.corporateUsername} ${link.corporateDisplayName} ${link.corporateId} ${link.thirdPartyUsername} ${link.thirdPartyId} ` : '';
  let accountIdentity = member.login ? member.login.toLowerCase() : member.account.login.toLowerCase();
  let combined = (linkIdentity + accountIdentity).toLowerCase();
  return combined.includes(phrase);
}
