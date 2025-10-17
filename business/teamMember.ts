//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ICorporateLink } from '../interfaces/index.js';
import * as common from './common.js';
import { Operations } from './operations/core.js';
import { Team } from './team.js';

// prettier-ignore
const memberPrimaryProperties = [
  'id',
  'login',
  'permissions',
  'avatar_url',
];
const memberSecondaryProperties = [];

export type TeamMemberJson = {
  id: number;
  login: string;
  avatar_url: string;
};

export class TeamMember {
  private _team: Team;
  private _operations: Operations;
  private _link: ICorporateLink;
  private _id: number;
  private _avatar_url: string;
  private _mailAddress: string;
  private _login: string;
  private _permissions: any;

  get team(): Team {
    return this._team;
  }

  get link(): ICorporateLink {
    return this._link;
  }

  set link(value: ICorporateLink) {
    // console.warn('TeamMember.link was set');
    this._link = value;
  }

  get id(): number {
    return this._id;
  }

  get avatar_url(): string {
    return this._avatar_url;
  }

  get permissions(): any {
    return this._permissions;
  }

  get login(): string {
    return this._login;
  }

  constructor(team: Team, entity: any, operations: Operations) {
    this._team = team;
    if (entity) {
      common.assignKnownFieldsPrefixed(
        this,
        entity,
        'member',
        memberPrimaryProperties,
        memberSecondaryProperties
      );
    }
    this._operations = operations;
  }

  asJson(): TeamMemberJson {
    return {
      id: this.id,
      login: this.login,
      avatar_url: this.avatar_url,
    };
  }

  // ----------------------------------------------------------------------------
  // Retrieves the URL for the user's avatar, if present. If the user's details
  // have not been loaded, we will not yet have an avatar URL.
  // ----------------------------------------------------------------------------
  avatar(optionalSize) {
    if (!optionalSize) {
      optionalSize = 80;
    }
    if (this._avatar_url) {
      return this._avatar_url + '&s=' + optionalSize;
    }
  }

  get contactEmail() {
    return this._mailAddress || undefined;
  }

  get contactName() {
    return this._link ? this._link.corporateUsername : undefined;
  }

  get mailAddress() {
    return this._mailAddress;
  }

  async getMailAddress(): Promise<string> {
    if (this._mailAddress) {
      return this._mailAddress;
    }
    const operations = this._operations as Operations;
    const providers = operations.providers;
    const link = await this.resolveDirectLink();
    if (!link) {
      return;
    }
    if (!providers.mailAddressProvider) {
      throw new Error('No mailAddressProvider is available in this application instance');
    }
    // Preventing a crash when trying to send a mail to an unlinked account
    const mailAddress = link
      ? await providers.mailAddressProvider.getAddressFromUpn(link.corporateUsername)
      : null;
    this._mailAddress = mailAddress;
    return mailAddress;
  }

  async resolveDirectLink(): Promise<ICorporateLink> {
    // This method was added to directly attach a link instance
    // equivalent to the legacy implementation of team mgmt.
    // TODO: CONSIDER: a better design...
    if (this._link) {
      return this._link;
    }
    const operations = this._operations as Operations;
    try {
      this._link = await operations.getLinkByThirdPartyId(this._id.toString());
    } catch (ignoredResolutionError) {
      console.dir(ignoredResolutionError);
    }
    return this._link;
  }
}
