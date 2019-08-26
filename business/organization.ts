import { Operations } from "./operations";
import { IReposError, ICallback, ICacheOptions, IGetOwnerToken, IPagedCacheOptions } from "../transitional";

//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

import _ from 'lodash';

import * as common from './common';
import { OrganizationMember } from "./organizationMember";
import { Team, GitHubTeamRole } from "./team";
import { Repository } from "./repository";

import { wrapError } from '../utils';
import { StripGitHubEntity } from "../lib/github/restApi";
import { GitHubResponseType } from "../lib/github/endpointEntities";

export interface ICreateRepositoryResult {
  response: any;
  repository: Repository;
}

export enum OrganizationMembershipState {
  Active = 'active',
  Pending = 'pending',
}

export enum OrganizationMembershipRole {
  Member = 'member',
  Admin = 'admin',
}

export enum OrganizationMembershipRoleQuery {
  Member = 'member',
  Admin = 'admin',
  All = 'all',
}

export enum OrganizationMembershipTwoFactorFilter {
  AllMembers = 'all',
  TwoFactorOff = '2fa_disabled',
}

export interface IGetOrganizationMembersOptions extends IPagedCacheOptions {
  filter?: OrganizationMembershipTwoFactorFilter;
  role?: OrganizationMembershipRoleQuery;
}

export interface IAddOrganizationMembershipOptions extends ICacheOptions {
  role?: OrganizationMembershipRole;
}

export interface IOrganizationMembership {
  state: OrganizationMembershipState;
  role: OrganizationMembershipRole;
  organization: any;
  user: any;
}

interface IGetMembersParameters {
  org: string;
  per_page: number;
  filter?: string;
  role?: string;
}

interface ICheckPublicMembershipParameters {
  username: string;
  org: string;
  allowEmptyResponse?: boolean;
}

interface IRedirectError extends IReposError {
  status?: number;
  slug?: string;
  team?: Team;
}

export interface IAdministratorBasics {
  id: string;
  login: string;
  sudo: boolean;
  owner: boolean;
}

export class Organization {
  private _name: string;
  private _baseUrl: string;

  private _operations: Operations;
  private _getOwnerToken: IGetOwnerToken;
  private _settings: any;

  id: string;

  constructor(operations: Operations, name: string, settings: any) {
    this._name = settings.name || name;
    this._baseUrl = operations.baseUrl + this.name + '/';

    this._operations = operations;
    this._settings = settings;
    this._getOwnerToken = getOwnerToken.bind(this);
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  get name(): string {
    return this._name;
  }

  repository(name: string, optionalEntity?) {
    let entity = optionalEntity || {};
    if (!optionalEntity) {
      entity.name = name;
    }
    const repository = new Repository(
      this,
      entity,
      this._getOwnerToken,
      this._operations);
    // CONSIDER: Cache any repositories in the local instance
    return repository;
  }

  getRepositories(options?: IPagedCacheOptions): Promise<Repository[]> {
    return new Promise((resolve, reject) => {
      options = options || {};
      const operations = this._operations;
      const token = this._getOwnerToken();
      const github = operations.github;
      const parameters = {
        org: this.name,
        type: 'all',
        per_page: operations.defaultPageSize,
      };
      const caching = {
        maxAgeSeconds: options.maxAgeSeconds || operations.defaults.orgReposStaleSeconds,
        backgroundRefresh: true,
        pageRequestDelay: options.pageRequestDelay || null,
      };
      if (options && options.backgroundRefresh === false) {
        caching.backgroundRefresh = false;
      }
      return github.collections.getOrgRepos(
        token,
        parameters,
        caching,
        common.createPromisedInstances<Repository>(this, this.repositoryFromEntity, resolve, reject));
    });
  }

  createRepositoryInstances(repos, callback) {
    common.createInstancesCallback(this, this.repositoryFromEntity, callback)(null, repos);
  }

  get legacyNotificationsRepository() {
    const repoName = this._settings.notificationRepo;
    if (!repoName) {
      throw new Error('No workflow/notification repository is defined for the organization.');
    }
    return this.repository(repoName);
  }

  get priority(): string {
    return this._settings.priority || 'primary';
  }

  get locked(): boolean {
    return this._settings.locked || false;
  }

  get hidden(): boolean {
    return this._settings.hidden || false;
  }

  get pilot_program() {
    return this._settings['1es'];
  }

  get overwriteRemainingPrivateRepos() {
    // An organization may be using the GitHub per-seat model, which includes
    // unlimited private repositories; however, since we want to encourage
    // the concept of a limit, an org setting may overwrite this experience in
    // the user interface. Yes, a dirty hack I suppose.
    return this._settings['overwriteRemainingPrivateRepos'];
  }

  get createRepositoriesOnGitHub(): boolean {
    return this._settings.createReposDirect || false;
  }

  get configuredOrganizationRepositoryTypes(): string {
    return this._settings.type || 'public';
  }

  get legacyTrainingResourcesLink() {
    return this._settings.trainingResources;
  }

  get privateEngineering(): boolean {
    return this._settings.privateEngineering || false;
  }

  get externalMembersPermitted(): boolean {
    return this._settings.externalMembersPermitted || false;
  }

  get preventLargeTeamPermissions(): boolean {
    return this._settings.preventLargeTeamPermissions || false;
  }

  get description(): string {
    return this._settings.description;
  }

  get webhookSharedSecrets(): string[] {
    const orgSettings = this._settings;
    // Multiple shared can be specified at the organization level to allow for rotation
    let orgSpecificSecrets = orgSettings.hookSecrets || [];
    const systemwideConfig = this._operations.config;
    let systemwideSecrets = systemwideConfig.github && systemwideConfig.github.webhooks && systemwideConfig.github.webhooks.sharedSecret ? systemwideConfig.github.webhooks.sharedSecret : null;
    return _.concat([], orgSpecificSecrets, systemwideSecrets);
  }

  get broadAccessTeams(): number[] {
    return this.getSpecialTeam('teamAllMembers', 'everyone membership');
  }

  get invitationTeam(): Team {
    const teams = this.broadAccessTeams;
    if (teams.length > 1) {
      throw new Error('Multiple invitation teams are not supported.');
    }
    return teams.length === 1 ? this.team(teams[0]) : null;
  }

  get repositoryApproversTeam(): Team {
    const teams = this.getSpecialTeam('teamRepoApprovers', 'organization repository approvers');
    if (teams.length > 1) {
      throw new Error('Multiple repository approval teams are not supported.');
    }
    return teams.length === 1 ? this.team(teams[0]) : null;
  }

  get systemSudoersTeam(): Team {
    const teams = this.getSpecialTeam('teamPortalSudoers', 'system sudoers');
    if (teams.length > 1) {
      throw new Error('Multiple system sudoer teams are not supported.');
    }
    return teams.length === 1 ? this.team(teams[0]) : null;
  }

  get privateRepositoriesSupported(): boolean {
    return getSupportedRepositoryTypesByPriority(this).includes('private');
  }

  get sudoersTeam(): Team {
    const teams = this.getSpecialTeam('teamSudoers', 'organization sudoers');
    if (teams.length > 1) {
      throw new Error('Multiple sudoer teams are not supported.');
    }
    return teams.length === 1 ? this.team(teams[0]) : null;
  }

  get specialRepositoryPermissionTeams() {
    return {
      read: this.getSpecialTeam('teamAllReposRead', 'read everything'),
      write: this.getSpecialTeam('teamAllReposWrite', 'write everything'),
      admin: this.getSpecialTeam('teamAllReposAdmin', 'administer everything'),
    };
  }

  async getOrganizationAdministrators(): Promise<IAdministratorBasics[]> {
    // returns an array containing an ID and properties 'owner' and 'sudo' for each
    const administrators = new Map<string, IAdministratorBasics>();
    function getAdministratorEntry(id: string, login: string) {
      let administrator = administrators.get(id);
      if (!administrator) {
        administrator = {
          id,
          login,
          sudo: false,
          owner: false,
        };
        administrators.set(id, administrator);
      }
      return administrator;
    }
    const owners = await this.getOwners();
    for (let i = 0; i < owners.length; i++) {
      const id = owners[i].id;
      const login = owners[i].login;
      getAdministratorEntry(id, login).owner = true;
    }
    const sudoTeam = this.sudoersTeam;
    if (!sudoTeam) {
      return Array.from(administrators.values());
    }
    try {
      const members = await sudoTeam.getMembers();
      for (let i = 0; i < members.length; i++) {
        const id = members[i].id;
        const login = members[i].login;
        getAdministratorEntry(id, login).sudo = true;
      }
      return Array.from(administrators.values());
    } catch (error) {
      if (error && error.status === 404) {
        // The sudo team no longer exists, but we should still have administrator information
        return Array.from(administrators.values());
      }
      throw error;
    }
  }

  get systemTeamIds() {
    const teamIds = [];
    const sudoTeamInstance = this.sudoersTeam;
    if (sudoTeamInstance) {
      teamIds.push(sudoTeamInstance.id);
    }
    const broadAccessTeams = this.broadAccessTeams;
    if (broadAccessTeams) {
      for (let i = 0; i < broadAccessTeams.length; i++) {
        teamIds.push(broadAccessTeams[i]); // is the actual ID, not the team object
      }
    }
    const specialTeams = this.specialRepositoryPermissionTeams;
    const keys = Object.getOwnPropertyNames(specialTeams);
    keys.forEach(type => {
      const values = specialTeams[type];
      if (Array.isArray(values)) {
        Array.prototype.push.apply(teamIds, values);
      }
    });
    return teamIds;
  }

  get legalEntities() {
    const settings = this._settings;
    const claToTeams = settings.cla;
    if (claToTeams) {
      return Object.getOwnPropertyNames(claToTeams);
    }
    if (settings.legalEntities) {
      return settings.legalEntities;
    }
    throw new Error('No legal entities available or defined for the organization, or all organizations through the default value');
  }

  get legalEntityClaTeams() {
    const settings = this._settings;
    return settings.cla;
  }

  get disasterRecoveryVstsPath() {
    const operations = this._operations;
    const disasterRecoveryConfiguration = operations.disasterRecoveryConfiguration;
    if (!disasterRecoveryConfiguration || !disasterRecoveryConfiguration.vsts || !disasterRecoveryConfiguration.vsts.hostname) {
      return null;
    }
    const vstsMirror = disasterRecoveryConfiguration.vsts;
    const vstsPath = vstsMirror.path || {};
    const orgPrefix = vstsPath.organizationPrefix || '';
    const orgSuffix = vstsPath.organizationSuffix || '';
    return `${vstsMirror.hostname}${orgPrefix}${this.name}${orgSuffix}`;
  }

  getRepositoryCreateGitHubToken() {
    // This method leaks/releases the owner token. In the future a more crisp
    // way of accomplishing this without exposing the token should be created.
    // The function name is specific to the intended use instead of a general-
    // purpose token name.
    return this._getOwnerToken();
  }

  createRepository(repositoryName: string, options): Promise<ICreateRepositoryResult> {
    // TODO: create repository options interface
    return new Promise((resolve, reject) => {
      const token = this._getOwnerToken();
      const operations = this._operations;
      const orgName = this.name;
      delete options.name;
      delete options.org;
      const parameters = Object.assign({
        org: orgName,
        name: repositoryName,
      }, options);
      return operations.github.post(token, 'repos.createInOrg', parameters, (error, details) => {
        if (error) {
          let contextualError = '';
          if (error.errors && Array.isArray(error.errors)) {
            contextualError = error.errors.map(errorEntry => errorEntry.message).join(', ') + '. ';
          }
          const friendlyErrorMessage = `${contextualError}Could not create the repository ${orgName}/${repositoryName}`;
          return reject(wrapError(error, friendlyErrorMessage));
        }
        const newRepository = this.repositoryFromEntity(details);
        let response = details;
        try {
          response = StripGitHubEntity(GitHubResponseType.Repository, details, 'repos.createInOrg');
        } catch (parseError) { }
        const result: ICreateRepositoryResult = {
          repository: newRepository,
          response,
        };
        return resolve(result);
      });
    });
  }

  getDetails(): Promise<any> {
    return new Promise((resolve, reject) => {
      const token = this._getOwnerToken();
      const operations = this._operations;
      const parameters = {
        org: this.name,
      };
      return operations.github.call(token, 'orgs.get', parameters, (error, entity) => {
        if (error) {
          return reject(wrapError(error, `Could not get details about the ${this.name} organization: ${error.message}`));
        }
        if (entity && entity.id) {
          this.id = entity.id;
        }
        return resolve(entity);
      });
    });
  }

  getRepositoryCreateMetadata(options?: any) {
    const operations = this._operations;
    const settings = this._settings;
    const config = operations.config;
    const metadata = {
      approval: {
        fields: config.github.approvalTypes ? config.github.approvalTypes.fields : undefined,
      },
      legalEntities: this.legalEntities,
      gitIgnore: {
        default: settings.defaultGitIgnoreLanguage || operations.config.github.gitignore.default,
        languages: operations.config.github.gitignore.languages,
      },
      supportsCla: settings.cla && true,
      templates: getRepositoryCreateTemplates(this, operations, options || {}),
      visibilities: getSupportedRepositoryTypesByPriority(this),
    };
    return metadata;
  }

  async getTeamFromName(nameOrSlug: string, options?: ICacheOptions): Promise<Team> {
    options = options || {};
    const operations = this._operations;
    // Slightly more aggressive attempt to look for the latest team
    // information to help prevent downtime when a new team is created
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = operations.defaults.orgTeamsSlugLookupStaleSeconds;
    }
    const expected = nameOrSlug.toLowerCase();
    const teams = await this.getTeams(options);
    let alternativeCandidateById: Team = null;
    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      const name = team.name.toLowerCase();
      const slug = team.slug.toLowerCase();
      // Considered a light error condition, this will callback with
      // both a suggestion to redirect to the slug-based name and
      // a legitimate link to the team in the error;
      // TODO: hook up this new change
      if (expected === name && name !== slug) {
        const redirectError: IRedirectError = new Error(`The team is also available by slug: ${slug}.`);
        redirectError.status = 301;
        redirectError.slug = slug;
        redirectError.team = team;
        throw redirectError;
      }
      if (team.id == expected) {
        alternativeCandidateById = team;
      }
      if (expected === slug) {
        return team;
      }
    }
    if (alternativeCandidateById) {
      const redirectError: IRedirectError = new Error(`The team is also available by slug: ${alternativeCandidateById.slug}.`);
      redirectError.status = 301;
      redirectError.slug = alternativeCandidateById.slug;
      redirectError.team = alternativeCandidateById;
      throw alternativeCandidateById;
    }
    const teamNotFoundError: IReposError = new Error('No team was found within the organization matching the provided name');
    teamNotFoundError.status = 404;
    teamNotFoundError.skipLog = true;
    throw teamNotFoundError;
  }

  team(id, optionalEntity?): Team {
    let entity = optionalEntity || {};
    if (!optionalEntity) {
      entity.id = id;
    }
    const team = new Team(
      this,
      entity,
      this._getOwnerToken,
      this._operations);
    // CONSIDER: Cache any teams in the local instance
    return team;
  }

  member(id, optionalEntity?): OrganizationMember {
    let entity = optionalEntity || {};
    if (!optionalEntity) {
      entity.id = id;
    }
    const member = new OrganizationMember(
      this,
      entity,
      this._getOwnerToken,
      this._operations);
    // CONSIDER: Cache any members in the local instance
    return member;
  }

  getOwners(options?: IPagedCacheOptions): Promise<OrganizationMember[] /* TODO: validate return type */> {
    const memberOptions = Object.assign({}, options) as IGetOrganizationMembersOptions;
    memberOptions.role = OrganizationMembershipRoleQuery.Admin;
    return this.getMembers(memberOptions);
  }

  async isSudoer(username: string): Promise<boolean> {
    const sudoerTeam = this.sudoersTeam;
    if (!sudoerTeam) {
      return false;
    }
    const appConfig = this._operations.config;
    if (appConfig.github.debug && appConfig.github.debug.orgSudoOff) {
      console.warn('DEBUG WARNING: Organization sudo support is turned off in the current environment');
      return false;
    }
    let membership: GitHubTeamRole = null;
    try {
      const response = await sudoerTeam.getMembershipEfficiently(username);
      if (response && response.role) {
        membership = response.role;
      }
    } catch (getMembershipError) {
      // The team for sudoers may have been deleted, which is not an error
      if (getMembershipError && getMembershipError.status == /* loose */ 404) {
        return false;
      }
      throw getMembershipError;
    }
    const isKnownMembership = membership === GitHubTeamRole.Member || membership === GitHubTeamRole.Maintainer;
    if (membership && isKnownMembership) {
      return isKnownMembership;
    } else if (membership) {
      throw new Error(`Cannot determine sudo status for ${username}, unrecognized membership type: ${membership}`);
    } else {
      return false;
    }
  }

  acceptOrganizationInvitation(userToken: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const operations = this._operations;
      const parameters = {
        org: this.name,
        state: 'active',
      };
      return operations.github.post(userToken, 'orgs.updateMembership', parameters, (error, response) => {
        if (error) {
          return reject(wrapError(error, `Could not accept your invitation for the ${this.name} organization on GitHub`));
        }
        return resolve(response);
      });
    });
  }

  getMembership(username: string, options?: ICacheOptions): Promise<IOrganizationMembership> {
    return new Promise((resolve, reject) => {
      options = options || {};
      const orgName = this.name;
      const parameters = {
        username: username,
        org: orgName,
      };
      const operations = this._operations;
      const token = this._getOwnerToken();
      return operations.github.call(token, 'orgs.getMembership', parameters, (error, result) => {
        if (error && error.status == /* loose */ 404) {
          return resolve(null);
        }
        if (error) {
          let reason = error.message;
          if (error.status) {
            reason += ' ' + error.status;
          }
          const wrappedError = wrapError(error, `Trouble retrieving the membership for "${username}" in the ${orgName} organization. ${reason}`);
          if (error.status) {
            wrapError['code'] = error.status;
            wrapError['status'] = error.status;
          }
          return reject(wrappedError);
        }
        return resolve(result);
      });
    });
  }

  async getOperationalMembership(username: string): Promise<IOrganizationMembership> {
    if (!username) {
      throw new Error('username must be provided');
    }
    // This is a specific version of the getMembership function that takes
    // no options and never allows for caching [outside of the standard
    // e-tag validation with the real-time GitHub API]
    const options = {
      backgroundRefresh: false,
      maxAgeSeconds: -60,
    };
    return await this.getMembership(username, options);
  }

  addMembership(username: string, options?: IAddOrganizationMembershipOptions): Promise<any> {
    return new Promise((resolve, reject) => {
      const operations = this._operations;
      const token = this._getOwnerToken();
      const github = operations.github;
      options = options || {};
      const role = options.role || 'member';
      const parameters = {
        org: this.name,
        username: username,
        role: role,
      };
      github.post(token, 'orgs.addOrUpdateMembership', parameters, (error, ok) => {
        return error ? reject(error) : resolve(ok);
      });
    });
  }

  checkPublicMembership(username: string, options?: ICacheOptions): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // NOTE: This method is unable to be cached by the underlying
      // system since there is no etag returned for status code-only
      // results.
      options = options || {};
      const parameters: ICheckPublicMembershipParameters = {
        username: username,
        org: this.name,
      };
      const operations = this._operations;
      const token = this._getOwnerToken();
      parameters.allowEmptyResponse = true;
      return operations.github.post(token, 'orgs.checkPublicMembership', parameters, error => {
        // The user either is not a member of the organization, or their membership is concealed
        if (error && error.status == /* loose */ 404) {
          return resolve(false);
        }
        if (error) {
          return reject(wrapError(error, `Trouble retrieving the public membership status for ${username} in the ${this.name} organization: ${error.message}`));
        }
        return resolve(true);
      });
    });
  }

  concealMembership(login: string, userToken: string, callback) {
    return new Promise((resolve, reject) => {
      // This call required a provider user token with the expanded write:org scope
      const operations = this._operations;
      const parameters = {
        org: this.name,
        username: login,
      };
      return operations.github.post(userToken, 'orgs.concealMembership', parameters, (error) => {
        if (error) {
          return reject(wrapError(error, `Could not conceal the ${this.name} organization membership for  ${login}: ${error.message}`));
        }
        return resolve();
      });
    });
  }

  publicizeMembership(login: string, userToken: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // This call required a provider user token with the expanded write:org scope
      const operations = this._operations;
      const parameters = {
        org: this.name,
        username: login,
      };
      return operations.github.post(userToken, 'orgs.publicizeMembership', parameters, (error) => {
        if (error) {
          return reject(wrapError(error, `Could not publicize the ${this.name} organization membership for  ${login}: ${error.message}`));
        }
        return resolve();
      });
    });
  }

  getMembers(options?: IGetOrganizationMembersOptions): Promise<OrganizationMember[] /*todo: validate*/> {
    return new Promise((resolve, reject) => {
      options = options || {};
      const operations = this._operations;
      const token = this._getOwnerToken();
      const github = operations.github;
      const parameters: IGetMembersParameters = {
        org: this.name,
        per_page: operations.defaultPageSize,
      };
      if (options.filter) {
        parameters.filter = options.filter;
      }
      if (options.role) {
        parameters.role = options.role;
      }
      const caching = {
        maxAgeSeconds: options.maxAgeSeconds || operations.defaults.orgMembersStaleSeconds,
        backgroundRefresh: true,
        pageRequestDelay: options.pageRequestDelay,
      };
      if (options && options.backgroundRefresh === false) {
        caching.backgroundRefresh = false;
      }
      return github.collections.getOrgMembers(
        token,
        parameters,
        caching,
        common.createPromisedInstances(this, this.memberFromEntity, resolve, reject));
    });
  }

  getMembersWithoutTwoFactor(options?: IPagedCacheOptions): Promise<any> {
    const clonedOptions: IGetOrganizationMembersOptions = Object.assign({}, options || {});
    clonedOptions.filter = OrganizationMembershipTwoFactorFilter.TwoFactorOff;
    return this.getMembers(clonedOptions);
  }

  async isMemberSingleFactor(username: string, options?: IPagedCacheOptions): Promise<boolean> {
    const membersWithoutTwoFactor = await this.getMembersWithoutTwoFactor(options);
    const lowerCase = username.toLowerCase();
    for (let i = 0; i < membersWithoutTwoFactor.length; i++) {
      const lc = membersWithoutTwoFactor[i].login.toLowerCase();
      if (lowerCase === lc) {
        return true;
      }
    }
    return false;
  }

  getTeams(options?: IPagedCacheOptions): Promise<Team[]> {
    return new Promise((resolve, reject) => {
      options = options || {};
      const operations = this._operations;
      const token = this._getOwnerToken();
      const github = operations.github;
      const parameters = {
        org: this.name,
        per_page: operations.defaultPageSize,
      };
      const caching: IPagedCacheOptions = {
        maxAgeSeconds: options.maxAgeSeconds || operations.defaults.orgTeamsStaleSeconds,
        backgroundRefresh: true,
        pageRequestDelay: options.pageRequestDelay || null,
      };
      caching.backgroundRefresh = options.backgroundRefresh;
      return github.collections.getOrgTeams(
        token,
        parameters,
        caching,
        common.createPromisedInstances<Team>(this, this.teamFromEntity, resolve, reject));
    });
  }

  removeMember(login: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = this._getOwnerToken();
      const operations = this._operations;
      const parameters = {
        org: this.name,
        username: login,
      };
      return operations.github.post(token, 'orgs.removeMembership', parameters, error => {
        if (error) {
          return reject(wrapError(error, 'Could not remove the organization member ${login}'));
        }
        return resolve();
      });
    });
  }

  getMembershipInvitations(): Promise<any> {
    return new Promise((resolve, reject) => {
      const token = this._getOwnerToken();
      const operations = this._operations;
      const parameters = {
        org: this.name,
      };
      return operations.github.call(token, 'orgs.listPendingInvitations', parameters, (error, invitations) => {
        if (error && error.status != /* loose */ 404) {
          return reject(wrapError(error, `Could not retrieve ${this.name} organization invitations: ${error.message}`));
        }
        return resolve(invitations);
      });
    });
  }

  memberFromEntity(entity): OrganizationMember {
    return this.member(entity.id, entity);
  }

  teamFromEntity(entity): Team {
    return this.team(entity.id, entity);
  }

  repositoryFromEntity(entity): Repository {
    return this.repository(entity.name, entity);
  }

  // ----------------------------------------------------------------------------
  // Special Team: "CLA" write teams used for authoring the CLA user to create
  // labels and other activities for the legacy CLA project.
  // ----------------------------------------------------------------------------
  getClaWriteTeams(throwIfMissing) {
    const settings = this._settings;
    if (throwIfMissing === undefined) {
      throwIfMissing = true;
    }
    let claSettings = settings.cla;
    if (!claSettings) {
      const message = `No CLA configurations defined for the ${this.name} org.`;
      if (throwIfMissing === true) {
        throw new Error(message);
      } else {
        console.warn(message);
        return null;
      }
    }
    let clas = {};
    for (const key in claSettings) {
      clas[key] = this.team(claSettings[key]);
    }
    return clas;
  }

  getLegacySystemObjects() {
    const settings = this._settings;
    const operations = this._operations;
    return [settings, operations];
  }

  private getSpecialTeam(propertyName: string, friendlyName: string, throwIfMissing?: boolean): number[] {
    const settings = this._settings;
    if (!settings[propertyName] && throwIfMissing) {
      throw new Error(`Missing configured organization "${this.name}" property ${propertyName} (special team ${friendlyName})`);
    }
    const value = settings[propertyName];
    if (value && Array.isArray(value)) {
      const asNumbers: number[] = [];
      for (let i = 0; i < value.length; i++) {
        asNumbers.push(parseInt(value[i], 10));
      }
      return asNumbers;
    }
    const teams: number[] = [];
    if (value) {
      teams.push(parseInt(value, 10));
    }
    return teams;
  }

}

function getSupportedRepositoryTypesByPriority(self) {
  // Returns the types of repositories supported by the configuration for the organization.
  // The returned array position 0 represents the recommended default choice for new repos.
  // Note that while the configuration may say 'private', the organization may not have
  // a billing relationship, so repo create APIs would fail asking you to upgrade to a paid
  // plan.
  const settings = self._settings;
  const type = settings.type || 'public';
  let types = ['public'];
  switch (type) {
  case 'public':
    break;
  case 'publicprivate':
    types.push('private');
    break;
  case 'private':
    types.splice(0, 1, 'private');
    break;
  case 'privatepublic':
    types.splice(0, 0, 'private');
    break;
  default:
    throw new Error(`Unsupported configuration for repository types in the organization: ${type}`);
  }
  return types;
}

function getOwnerToken(): string {
  let tok = this._settings.ownerToken;
  return tok;
}

function getRepositoryCreateTemplates(self, operations, options) {
  options = options || {};
  const projectType = options.projectType;
  // projectType option:
  // if any only if present in the request AND there is a 'forceForReleaseType'
  // value set on at least one template, return only the set of 'forced'
  // templates. the scenario enabled here is to allow sample code to always
  // force one of the official sample code templates and not fallback to
  // standard templates.
  const config = operations.config;
  const templates = [];
  const configuredTemplateRoot = config.github.templates || {};
  const configuredTemplateDefinitions = configuredTemplateRoot && configuredTemplateRoot.definitions ? configuredTemplateRoot.definitions : {};
  const templateDefinitions = configuredTemplateDefinitions || {};
  const allTemplateNames = Object.getOwnPropertyNames(templateDefinitions);
  const ts = self._settings.templates || allTemplateNames;
  const legalEntities = self.legalEntities;
  const limitedTypeTemplates = [];
  ts.forEach(templateId => {
    const td = templateDefinitions[templateId];
    const candidateTemplate = Object.assign({id: templateId}, td);
    let template = null;
    if (candidateTemplate.legalEntity) {
      for (let i = 0; i < legalEntities.length && !template; i++) {
        if (legalEntities[i].toLowerCase() === candidateTemplate.legalEntity.toLowerCase()) {
          template = candidateTemplate;
          template.legalEntities = [ template.legalEntity ];
          delete template.legalEntity;
        }
      }
    } else {
      candidateTemplate.legalEntities = legalEntities;
      template = candidateTemplate;
    }
    if (template) {
      templates.push(template);
      if (projectType && template.forceForReleaseType && template.forceForReleaseType == projectType) {
        limitedTypeTemplates.push(template);
      }
    }
  });
  if (projectType && limitedTypeTemplates.length) {
    return limitedTypeTemplates;
  }
  return templates;
}
