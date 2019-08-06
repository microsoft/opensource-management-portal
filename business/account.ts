//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

import _ from 'lodash';
import async from 'async';

import { Operations } from './operations';
import { ICacheOptions } from '../transitional';
import * as common from './common';

import { wrapError } from '../utils';
import { ILinkProvider } from '../lib/linkProviders/postgres/postgresLinkProvider';
import { ICorporateLink } from './corporateLink';
import { Organization } from './organization';

const primaryAccountProperties = [
  'id',
  'login',
  'avatar_url',
];
const secondaryAccountProperties = [];

export class Account {
  private _operations: Operations;
  private _getCentralOperationsToken: any;

  private _link: ICorporateLink;
  private _id: string;

  private _login: string;
  private _avatar_url?: string;
  private _created_at?: any;
  private _updated_at?: any;

  private _originalEntity?: any;

  public get id(): string {
    return this._id;
  }

  public get link(): ICorporateLink {
    return this._link;
  }

  public get login(): string {
    return this._login;
  }

  public get avatar_url(): string {
    return this._avatar_url;
  }

  public get updated_at(): any {
    return this._updated_at;
  }

  public get created_at(): any {
    return this._created_at;
  }

  public get company(): string {
    return this._originalEntity ? this._originalEntity.company : undefined;
  }

  constructor(entity, operations: Operations, getCentralOperationsToken) {
    common.assignKnownFieldsPrefixed(this, entity, 'account', primaryAccountProperties, secondaryAccountProperties);
    this._originalEntity = entity;

    this._operations = operations;
    this._getCentralOperationsToken = getCentralOperationsToken;
  }

  // TODO: looks like we need to be able to resolve the link in here, too, to set instance.link

  // These were previously implemented in lib/user.js; functions may be needed
  // May also need to be in the org- and team- specific accounts, or built as proper objects

  contactName() {
    if (this._link) {
      return this.link.corporateDisplayName || this.link['aadname'] || this._login;
    }
    return this._login;
  }

  contactEmail() {
    // NOTE: this field name is wrong, it is a UPN, not a mail address
    if (this._link) {
      return this.link.corporateUsername || this.link['aadupn'] || null;
    }
    return null;
  }

  corporateAlias() {
    // NOTE: this is a hack
    if (this.contactEmail()) {
      var email = this.contactEmail();
      var i = email.indexOf('@');
      if (i >= 0) {
        return email.substring(0, i);
      }
    }
  }

  corporateProfileUrl() {
    const operations = this._operations;
    const config = operations.config;
    const alias = this.corporateAlias();
    const corporateSettings = config.corporate;
    if (alias && corporateSettings && corporateSettings.profile && corporateSettings.profile.prefix) {
      return corporateSettings.profile.prefix + alias;
    }
  }

  avatar(optionalSize) {
    if (this._avatar_url) {
      return this._avatar_url + '&s=' + (optionalSize || 80);
    }
  }

  getProfileCreatedDate() {
    return this._created_at ? new Date(this._created_at) : undefined;
  }

  getProfileUpdatedDate() {
    return this._updated_at ? new Date(this._updated_at) : undefined;
  }

  // End previous functions

  getDetailsAndLink(options, callback?) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    this.getDetailsAndLinkAsync(options).then(empty => {
      return callback ? callback(null, empty) : undefined;
    }).catch(getDetailsError => {
      return callback ? callback(getDetailsError) : undefined;
    });
  }

  async getDetailsAndLinkAsync(options): Promise<Account> {
    try {
      await this.getDetailsAsync(options || {});
    } catch (getDetailsError) {
      // If a GitHub account is deleted, this would fail
      console.dir(getDetailsError);
    }

    const operations = this._operations;
    try {
      let link: ICorporateLink = await operations.getLinkWithOverheadAsync(this._id, options || {});
      if (link) {
        this._link = link;
      }
    } catch (getLinkError) {
        // We do not assume that the link exists...
        console.dir(getLinkError);
    }
    return this;
  }

  async getDetailsAndDirectLinkAsync(): Promise<Account> {
    // Instead of using the 'overhead' method (essentially cached, but from all links),
    // this uses the provider directly to ensure an accurate immediate, but by-individual
    // call. Most useful for verified results or when terminating accounts.
    try {
      await this.getDetailsAsync({});
    } catch (getDetailsError) {
      // If a GitHub account is deleted, this would fail
      console.dir(getDetailsError);
    }

    const operations = this._operations;
    try {
      let link = await operations.getLinkByThirdPartyId(this._id);
      if (link) {
        this._link = link;
      }
    } catch (getLinkError) {
      // We do not assume that the link exists...
      // TODO: can we only ignore WHEN WE KNOW ITS a 404 no link vs a 500?
      console.dir(getLinkError);
    }
    return this;
  }

  // FYI: TODO: replace or reimplement removed former function: updateLink(newLink, callback)

  getDetails(options, callback?) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const self = this;
    const token = this._getCentralOperationsToken();
    const operations = this._operations;
    const id = this._id;
    if (!id) {
      return callback(new Error('Must provide a GitHub user ID to retrieve account information.'));
    }
    const parameters = {
      id: id,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.accountDetailStaleSeconds,
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    return operations.github.request(token, 'GET /user/:id', parameters, cacheOptions, (error, entity) => {
      if (error && error.code && error.code === 404) {
        error = new Error(`The GitHub user ID ${id} could not be found (or was deleted)`);
        error.code = 404;
        return callback(error);
      } else if (error) {
        return callback(wrapError(error, `Could not get details about account "${id}".`));
      }
      common.assignKnownFieldsPrefixed(self, entity, 'account', primaryAccountProperties, secondaryAccountProperties);
      callback(null, entity);
    });
  }

  getDetailsAsync(options): Promise<any> {
    return new Promise((resolve, reject) => {
      this.getDetails(options, (error, entity) => {
        return error ? reject(error) : resolve(entity);
      });
    });
  }

  removeLink(callback) {
    const id = this._id;
    if (!id) {
      return callback(new Error('No user id known'));
    }
    this.removeLinkAsync().then(results => {
      return callback(null, results);
    }).catch(error => {
      return callback(error);
    });
  }

  async removeLinkAsync(): Promise<any> {
    const operations = this._operations;
    const linkProvider = operations.linkProvider as ILinkProvider;
    if (!linkProvider) {
      throw new Error('No link provider');
    }
    const id = this._id;
    try {
      await this.getDetailsAndDirectLinkAsync();
    } catch (getDetailsError) {
      // We ignore any error to make sure link removal always works
      const insights = this._operations.insights;
      if (insights && getDetailsError) {
        insights.trackException({
          exception: getDetailsError,
          properties: {
            id,
            location: 'account.removeLink',
          },
        });
      }
    }
    let aadIdentity = undefined;
    const link = this._link;
    if (!link) {
      throw new Error(`No link is associated with the instance for account ${id}`);
    }
    aadIdentity = {
      preferredName: link.corporateDisplayName,
      userPrincipalName: link.corporateUsername,
      id: link.corporateId,
    };
    const eventData = {
      github: {
        id: id,
        login: this._login,
      },
      aad: aadIdentity,
    };
    const history = [];
    let finalError = null;
    try {
      await deleteLink(linkProvider, link);
    } catch (linkDeleteError) {
      const message = linkDeleteError.statusCode === 404 ? `The link for ID ${id} no longer exists: ${linkDeleteError}` : `The link for ID ${id} could not be removed: ${linkDeleteError}`;
      history.push(message);
      finalError = linkDeleteError;
    }
    if (!finalError) {
      operations.fireUnlinkEvent(eventData);
      history.push(`The link for ID ${id} has been removed from the link service`);
    }
    return history;
  }

  // temporarily poor name going async
  removeManagedOrganizationMembershipsAsync(): Promise<any> {
    return new Promise((resolve, reject) => {
      this.removeManagedOrganizationMemberships((error, history) => {
        return error ? reject(error) : resolve(history);
      });
    });
  }

  // TODO: implement getOrganizationMemberships, with caching; reuse below code

  getOperationalOrganizationMemberships(callback) {
    const self = this;
    const operations = self._operations as Operations;
    const organizations = operations.organizations;
    // we want to make sure that we have an ID and username
    self.getDetails(getDetailsError => {
      if (getDetailsError) {
        return callback(getDetailsError);
      }
      const username = self._login;
      if (!username) {
        return callback(new Error(`No GitHub username available for user ID ${self._id}`));
      }
      let currentOrganizationMemberships = [];
      async.eachLimit(organizations.values(), 2, (organization: Organization, next) => {
        organization.getOperationalMembership(username, (getMembershipError, result) => {
          // getMembershipError is ignored - if there is no membership, that's fine
          if (result && result.state && (result.state === 'active' || result.state === 'pending')) {
            currentOrganizationMemberships.push(organization);
          }
          return next(/* we do not pass the error */);
        });
      }, error => {
        return callback(error ? error : null, error ? null : currentOrganizationMemberships);
      });
    });
  }

  removeManagedOrganizationMemberships(callback) {
    const self = this;
    const history = [];
    self.getOperationalOrganizationMemberships((error, organizations) => {
      const username = self._login;
      if (error && error.code == /* loose */ '404') {
        history.push(error.toString());
      } else if (error) {
        history.push(`Could get not org membership information because: ${error.toString()}`);
        return callback(error);
      }
      if (organizations && organizations.length > 1) {
        const asText = _.map(organizations, org => { return org.name; }).join(', ');
        history.push(`${username} is a member of the following organizations: ${asText}`);
      } else if (organizations) {
        history.push(`${username} is not a member of any managed organizations`);
      }
      let firstError = null;
      async.eachLimit(organizations, 1, (organization: Organization, next) => {
        organization.removeMember(username, removeError => {
          // We do not bubble up the error, keep going
          if (removeError) {
            history.push(`Error while removing ${username} from the ${organization.name} organization: ${removeError}`);
          } else {
            history.push(`Removed ${username} from the ${organization.name} organization`);
          }
          if (removeError && !firstError) {
            firstError = removeError;
          }
          return next();
        });
      }, error => {
        return callback(firstError || error, history);
      });
    });
  }
}

function deleteLink(linkProvider: ILinkProvider, link: ICorporateLink): Promise<any> {
  return new Promise((resolve, reject) => {
    linkProvider.deleteLink(link, (error, result) => {
      return error ? reject(error) : resolve(result);
    });
  });
}
