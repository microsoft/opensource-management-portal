//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import _ from 'lodash';

import * as common from './common.js';
import { throat } from '../vendor/throat/index.js';

import { wrapError } from '../lib/utils.js';
import { corporateLinkToJson } from './corporateLink.js';
import { Organization } from './organization.js';
import { AppPurpose } from '../lib/github/appPurposes.js';
import { ILinkProvider } from '../lib/linkProviders/index.js';
import {
  CacheDefault,
  Operations,
  createPagedCacheOptions,
  getMaxAgeSeconds,
  getPageSize,
  symbolizeApiResponse,
} from './index.js';
import {
  AccountJsonFormat,
  ICacheOptions,
  ICorporateLink,
  GetAuthorizationHeader,
  IGitHubAccountDetails,
  IReposError,
  OrganizationMembershipState,
  IPagedCacheOptions,
  NoCacheNoBackground,
  IOrganizationMembership,
  OrganizationMembershipRole,
  GitHubOrganizationEntity,
  GitHubSimpleAccount,
} from '../interfaces/index.js';
import { ErrorHelper } from '../lib/transitional.js';

interface IRemoveOrganizationMembershipsResult {
  error?: IReposError;
  history: string[];
}

// prettier-ignore
const primaryAccountProperties = [
  'id',
  'login',
  'avatar_url',
];
const secondaryAccountProperties = [];

export class Account {
  private _operations: Operations;
  private _getAuthorizationHeader: GetAuthorizationHeader | string;

  private _link: ICorporateLink;
  private _id: number;

  private _login: string;
  private _avatar_url?: string;
  private _created_at?: any;
  private _updated_at?: any;

  private _originalEntity?: IGitHubAccountDetails;
  private _deleted: boolean = false;

  public asJson(format: AccountJsonFormat = AccountJsonFormat.GitHub) {
    const basic = {
      avatar_url: this.avatar_url,
      id: this.id,
      login: this.login,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
    switch (format) {
      case AccountJsonFormat.GitHub: {
        return basic;
      }
      case AccountJsonFormat.GitHubExtended: {
        const cloneEntity = Object.assign({}, this._originalEntity || {});
        delete (cloneEntity as any).cost;
        delete (cloneEntity as any).headers;
        return cloneEntity;
      }
      case AccountJsonFormat.GitHubDetailedWithLink: {
        const cloneEntity = Object.assign({}, this._originalEntity || {});
        delete (cloneEntity as any).cost;
        delete (cloneEntity as any).headers;
        const link = this._link ? corporateLinkToJson(this._link) : undefined;
        return {
          account: cloneEntity,
          isLinked: !!link,
          link,
        };
      }
      case AccountJsonFormat.UplevelWithLink: {
        const link = this._link ? corporateLinkToJson(this._link) : undefined;
        return {
          account: basic,
          isLinked: !!link,
          link,
        };
      }
      default: {
        throw new Error(`Unsupported asJson format: ${format}`);
      }
    }
  }

  public get deleted(): boolean {
    return this._deleted;
  }

  public get id(): number {
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

  public get email(): string {
    return this._originalEntity ? this._originalEntity.email : undefined;
  }

  public get name(): string {
    return this._originalEntity ? this._originalEntity.name : undefined;
  }

  constructor(entity, operations: Operations, authorization: GetAuthorizationHeader | string) {
    common.assignKnownFieldsPrefixed(
      this,
      entity,
      'account',
      primaryAccountProperties,
      secondaryAccountProperties
    );
    this._originalEntity = entity;
    this._operations = operations;
    this._getAuthorizationHeader = authorization;
  }

  static async getAuthenticatedAccount(
    operations: Operations,
    authorization: GetAuthorizationHeader | string
  ) {
    const { github } = operations;
    const response = (await github.post(authorization, 'users.getAuthenticated', {})) as GitHubSimpleAccount;
    const account = new Account(response, operations, authorization);
    return account;
  }

  overrideAuthorization(getAuthorizationHeader: GetAuthorizationHeader | string) {
    this._getAuthorizationHeader = getAuthorizationHeader;
  }

  getEntity(): IGitHubAccountDetails {
    return this._originalEntity;
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
      const email = this.contactEmail();
      const i = email.indexOf('@');
      if (i >= 0) {
        return email.substring(0, i);
      }
    }
  }

  corporateProfileUrl() {
    const config = this._operations.providers.config;
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

  // End previous functions

  async getDetailsAndLink(options?: ICacheOptions): Promise<Account> {
    try {
      await this.getDetails(options || {});
    } catch (getDetailsError) {
      // If a GitHub account is deleted, this would fail
      console.dir(getDetailsError);
    }
    await this.tryGetLink();
    return this;
  }

  async tryGetLink() {
    try {
      this._link = await this._operations.tryGetLink(this._id.toString());
    } catch (getLinkError) {
      // We do not assume that the link exists...
      console.dir(getLinkError);
    }
  }

  async getRecentEventsFirstPage(options?: ICacheOptions): Promise<any[]> {
    options = options || {};
    const login = this.login;
    if (!login) {
      throw new Error('Must provide a GitHub login to retrieve account events.');
    }
    const parameters = {
      username: login,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(this._operations, CacheDefault.accountDetailStaleSeconds, options, 60),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const { github } = this._operations;
    const { rest } = github.octokit;
    try {
      const requirements = github.createRequirementsForFunction(
        this.authorize(AppPurpose.Data),
        rest.activity.listEventsForAuthenticatedUser,
        'activity.listEventsForAuthenticatedUser'
      );
      const entity = await github.callWithRequirements(requirements, parameters, cacheOptions);
      return entity;
    } catch (error) {
      console.dir(error);
      throw error;
    }
  }

  async getAuthenticatedUserOrganizations(options?: IPagedCacheOptions): Promise<GitHubOrganizationEntity[]> {
    options = options || {};
    const { github } = this._operations;
    const parameters = {
      per_page: getPageSize(this._operations),
    };
    const cacheOptions = createPagedCacheOptions(this._operations, options);
    try {
      const entities = await github.collections.collectAllPages<any, GitHubOrganizationEntity>(
        this.authorize(AppPurpose.Data),
        'orgCustomProps',
        'orgs.listForAuthenticatedUser',
        parameters,
        cacheOptions
      );
      return symbolizeApiResponse(entities);
    } catch (error) {
      throw error;
    }
  }

  async getAuthenticatedUserOwnershipStatus(options?: IPagedCacheOptions) {
    const { github } = this._operations;
    const orgs = await this.getAuthenticatedUserOrganizations(options);
    const state = new Map<GitHubOrganizationEntity, IOrganizationMembership>();
    const { rest } = github.octokit;
    for (const org of orgs) {
      try {
        const data = (await github.callWithRequirements(
          github.createRequirementsForFunction(
            this.authorize(AppPurpose.Data),
            rest.orgs.getMembershipForAuthenticatedUser,
            'orgs.getMembershipForAuthenticatedUser'
          ),
          {
            org: org.login,
          },
          options || NoCacheNoBackground
        )) as IOrganizationMembership;
        if (data) {
          state.set(org, data);
        }
      } catch (error) {
        if (ErrorHelper.IsNotAuthorized(error) && error?.message?.includes('lifetime is greater')) {
          let message = `${org.login} enforces a shorter classic PAT lifetime than we are using`;
          const GREATER_THAN = 'lifetime is greater than ';
          const indexIsGreaterThan = error?.message?.indexOf(GREATER_THAN);
          let lifetime = 'unknown';
          if (indexIsGreaterThan >= 0) {
            const remainder = error?.message?.substring(indexIsGreaterThan + GREATER_THAN.length);
            const following = remainder.indexOf('.');
            if (following >= 0) {
              lifetime = remainder.substring(0, following);
            }
          }
          message += ` (lifetime must at or under: ${lifetime})`;
          console.warn(message);
        } else if (ErrorHelper.IsNotAuthorized(error) && error?.message?.includes('SAML enforcement')) {
          console.warn(`SAML error for ${org.login} (PAT not SSO-authorized)`);
        } else {
          console.dir(error);
        }
      }
    }
    const owned = orgs.filter((org) => state.get(org)?.role === OrganizationMembershipRole.Admin);
    const memberOf = orgs.filter(
      (org) =>
        state.get(org)?.role === OrganizationMembershipRole.Member ||
        state.get(org)?.role === OrganizationMembershipRole.Admin
    );
    const otherTypes = orgs.filter(
      (org) =>
        state.get(org)?.role !== OrganizationMembershipRole.Member &&
        state.get(org)?.role !== OrganizationMembershipRole.Admin
    );
    const memberOnly = orgs.filter((org) => state.get(org)?.role === OrganizationMembershipRole.Member);
    const pending = orgs.filter((org) => state.get(org)?.state === OrganizationMembershipState.Pending);
    return { owned, memberOf, otherTypes, memberOnly, pending };
  }

  async getEvents(options?: ICacheOptions): Promise<any[]> {
    options = options || {};
    const login = this.login;
    if (!login) {
      throw new Error('Must provide a GitHub login to retrieve account events.');
    }
    const parameters = {
      username: login,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(
        this._operations as Operations,
        CacheDefault.accountDetailStaleSeconds,
        options
      ),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const github = this._operations.github;
    const { rest } = github.octokit;
    const requirements = github.createRequirementsForFunction(
      this.authorize(AppPurpose.Data),
      rest.activity.listEventsForAuthenticatedUser,
      'activity.listEventsForAuthenticatedUser'
    );
    try {
      const events = await github.collections.collectAllPagesWithRequirements<any, any>(
        'userActivity',
        requirements,
        parameters,
        cacheOptions
      );
      let cached = true;
      if (events && (events as any).cost && (events as any).cost.github.usedApiTokens > 0) {
        cached = false;
      }
      const arr = [...events];
      arr['cached'] = cached;
      return arr;
    } catch (error) {
      if (error.status && error.status === 404) {
        error = new Error(`The GitHub user ${login} could not be found (or has been deleted)`);
        error.status = 404;
        throw error;
      }
      throw wrapError(error, `Could not get events for login ${login}: ${error.message}`);
    }
  }

  async getDetailsAndDirectLink(throwIfDeletedAccount = false): Promise<Account> {
    try {
      await this.getDetails();
    } catch (getDetailsError) {
      if (ErrorHelper.IsNotFound(getDetailsError)) {
        this._deleted = true;
        if (throwIfDeletedAccount) {
          throw getDetailsError;
        }
        console.warn(`The GitHub account login=${this.login} has been deleted, renamed, or does not exist`);
      } else {
        throw getDetailsError;
      }
    }
    try {
      const link = await this._operations.getLinkByThirdPartyId(this._id.toString());
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

  async isDeleted(options?: ICacheOptions): Promise<boolean> {
    try {
      await this.getDetails(options);
    } catch (maybeDeletedError) {
      if (maybeDeletedError && maybeDeletedError.status && maybeDeletedError.status === 404) {
        return true;
      }
    }
    return false;
  }

  async getDetails(options?: ICacheOptions): Promise<IGitHubAccountDetails> {
    options = options || {};
    const id = this._id;
    if (!id) {
      throw new Error('Must provide a GitHub user ID to retrieve account information.');
    }
    const parameters = {
      id,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(this._operations, CacheDefault.accountDetailStaleSeconds, options, 60),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const { github } = this._operations;
    try {
      const entity = (await github.requestWithRequirements(
        github.createRequirementsForRequest(this._operations.getPublicAuthorizationToken(), 'GET /user/:id'),
        parameters,
        cacheOptions
      )) as IGitHubAccountDetails;
      common.assignKnownFieldsPrefixed(
        this,
        entity,
        'account',
        primaryAccountProperties,
        secondaryAccountProperties
      );
      this._originalEntity = entity;
      return entity;
    } catch (error) {
      if (error.status && error.status === 404) {
        error = new Error(`The GitHub user ID ${id} could not be found (or has been deleted)`);
        error.status = 404;
        throw error;
      }
      throw wrapError(error, `Could not get details about account ID ${id}: ${error.message}`);
    }
  }

  async removeLink(): Promise<any> {
    const linkProvider = this._operations.providers.linkProvider as ILinkProvider;
    if (!linkProvider) {
      throw new Error('No link provider');
    }
    const id = this._id;
    try {
      await this.getDetailsAndDirectLink(/* do not throw if deleted account */ false);
    } catch (getDetailsError) {
      // We ignore any error to make sure link removal always works
      const insights = this._operations.providers.insights;
      if (getDetailsError) {
        insights?.trackException({
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
        id,
        login: this._login,
      },
      aad: aadIdentity,
    };
    const history = [];
    let finalError = null;
    try {
      await deleteLink(linkProvider, link);
    } catch (linkDeleteError) {
      const message =
        linkDeleteError.statusCode === 404
          ? `The link for ID ${id} no longer exists: ${linkDeleteError}`
          : `The link for ID ${id} could not be removed: ${linkDeleteError}`;
      history.push(message);
      finalError = linkDeleteError;
    }
    if (!finalError) {
      this._operations.fireUnlinkEvent(eventData);
      history.push(`The link for ID ${id} has been removed from the link service`);
    }
    return history;
  }

  // TODO: implement getOrganizationMemberships, with caching; reuse below code

  async getOperationalOrganizationMemberships(): Promise<Organization[]> {
    await this.getDetails();
    const username = this._login; // we want to make sure that we have an ID and username
    if (!username) {
      throw new Error(`No GitHub username available for user ID ${this._id}`);
    }
    const currentOrganizationMemberships: Organization[] = [];
    const checkOrganization = async (organization: Organization) => {
      try {
        const result = await organization.getOperationalMembership(username);
        if (
          result &&
          result.state &&
          (result.state === OrganizationMembershipState.Active ||
            result.state === OrganizationMembershipState.Pending)
        ) {
          currentOrganizationMemberships.push(organization);
        }
      } catch (ignoreErrors) {
        // getMembershipError ignored: if there is no membership that's fine
        console.log(
          `error from individual check of organization ${organization.name} membership for username ${username}: ${ignoreErrors}`
        );
      }
    };
    const opsAs = this._operations as any;
    if (!opsAs.organizations) {
      throw new Error('Operations does not expose an organizations Map getter');
    }
    const allOrganizations = Array.from(opsAs.organizations.values() as Organization[]);
    const staticOrganizations = allOrganizations.filter((org) => org.hasDynamicSettings === false);
    const dynamicOrganizations = allOrganizations.filter((org) => org.hasDynamicSettings);
    const throttle = throat(5);
    await Promise.all(
      dynamicOrganizations.map((org) => {
        return throttle(() => checkOrganization(org));
      })
    );
    for (const organization of staticOrganizations) {
      await checkOrganization(organization);
    }
    return currentOrganizationMemberships;
  }

  async removeCollaboratorPermissions(
    onlyOneHundred?: boolean
  ): Promise<IRemoveOrganizationMembershipsResult> {
    // NOTE: this at least temporarily adds the ability to punt 100
    // but not all grants; probably should use options eventually vs bool param.
    const history = [];
    const error: IReposError = null;
    const { queryCache } = this._operations.providers;
    if (!queryCache || !queryCache.supportsRepositoryCollaborators) {
      history.push('The account may still have Collaborator permissions to repositories');
      return { history };
    }
    if (!this.login) {
      await this.getDetails();
    }
    const collaborativeRepos = await queryCache.userCollaboratorRepositories(this.id.toString());
    let i = 0;
    for (const entry of collaborativeRepos) {
      if (onlyOneHundred && i >= 100) {
        break;
      }
      const { repository } = entry;
      try {
        await repository.getDetails();
        if (repository.archived) {
          history.push(`FYI: removing grant from archived repository ${repository.full_name}`);
        }
        ++i;
        await repository.removeCollaborator(this.login);
        history.push(`Removed ${this.login} as a Collaborator from the repository ${repository.full_name}`);
      } catch (removeCollaboratorError) {
        if (ErrorHelper.IsNotFound(removeCollaboratorError)) {
          // The repo doesn't exist any longer, this is OK.
        } else {
          history.push(
            `Could not remove ${this.login} as a Collaborator from the repo: ${repository.full_name}`
          );
        }
      }
    }
    return { history, error };
  }

  async removeManagedOrganizationMemberships(): Promise<IRemoveOrganizationMembershipsResult> {
    const history = [];
    let error: IReposError = null;
    let organizations: Organization[];
    try {
      organizations = await this.getOperationalOrganizationMemberships();
    } catch (getMembershipError) {
      if (getMembershipError && getMembershipError.status == /* loose */ '404') {
        history.push(getMembershipError.toString());
      } else if (getMembershipError) {
        throw getMembershipError;
      }
    }
    const username = this._login;
    if (organizations && organizations.length > 1) {
      const asText = _.map(organizations, (org) => {
        return org.name;
      }).join(', ');
      history.push(`${username} was a member of the following organizations: ${asText}`);
    } else if (organizations) {
      history.push(`${username} is not a member of any managed organizations`);
    }
    if (organizations && organizations.length) {
      for (let i = 0; i < organizations.length; i++) {
        const organization = organizations[i];
        try {
          await organization.removeMember(username);
          history.push(`Removed ${username} from the ${organization.name} organization`);
        } catch (removeError) {
          history.push(
            `Error while removing ${username} from the ${organization.name} organization: ${removeError}`
          );
          if (!error) {
            error = removeError;
          }
        }
      }
    }
    return { history, error };
  }

  private authorize(purpose: AppPurpose): GetAuthorizationHeader | string {
    if (typeof this._getAuthorizationHeader === 'string') {
      return this._getAuthorizationHeader;
    }
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(this, purpose) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}

function deleteLink(linkProvider: ILinkProvider, link: ICorporateLink): Promise<any> {
  return linkProvider.deleteLink(link);
}
