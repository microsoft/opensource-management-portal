import { Operations } from "./operations";
import { IReposError } from "../transitional";

//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

const _ = require('lodash');

import * as common from './common';
import { OrganizationMember } from "./organizationMember";
import { Team } from "./team";
import { Repository } from "./repository";

import { wrapError } from '../utils';

export class Organization {
  private _name: string;
  private _baseUrl: string;

  private _operations: Operations;
  private _getOwnerToken: any;
  private _settings: any;

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

  repository(name, optionalEntity?) {
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

  getRepositories(options, callback) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};

    let operations = this._operations;
    let token = this._getOwnerToken();
    let github = operations.github;

    const parameters = {
      org: this.name,
      type: 'all',
      per_page: 100,
    };
    const caching = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.orgReposStaleSeconds,
      backgroundRefresh: true,
    };
    if (options && options.backgroundRefresh === false) {
      caching.backgroundRefresh = false;
    }

    return github.collections.getOrgRepos(
      token,
      parameters,
      caching,
      common.createInstancesCallback(this, this.repositoryFromEntity, callback));
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

  get priority() {
    return this._settings.priority || 'primary';
  }

  get locked() {
    return this._settings.locked || false;
  }

  get hidden() {
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

  get createRepositoriesOnGitHub() {
    return this._settings.createReposDirect || false;
  }

  get configuredOrganizationRepositoryTypes() {
    return this._settings.type || 'public';
  }

  get legacyTrainingResourcesLink() {
    return this._settings.trainingResources;
  }

  get privateEngineering() {
    return this._settings.privateEngineering || false;
  }

  get externalMembersPermitted() {
    return this._settings.externalMembersPermitted || false;
  }

  get preventLargeTeamPermissions() {
    return this._settings.preventLargeTeamPermissions || false;
  }

  get description() {
    return this._settings.description;
  }

  get webhookSharedSecrets() {
    const orgSettings = this._settings;

    // Multiple shared can be specified at the organization level to allow for rotation
    let orgSpecificSecrets = orgSettings.hookSecrets || [];

    const systemwideConfig = this._operations.config;
    let systemwideSecrets = systemwideConfig.github && systemwideConfig.github.webhooks && systemwideConfig.github.webhooks.sharedSecret ? systemwideConfig.github.webhooks.sharedSecret : null;

    return _.concat([], orgSpecificSecrets, systemwideSecrets);
  }

  get broadAccessTeams() {
    return getSpecialTeam(this, 'teamAllMembers', 'everyone membership');
  }

  get invitationTeam() {
    const teams = this.broadAccessTeams;
    if (teams.length > 1) {
      throw new Error('Multiple invitation teams are not supported.');
    }
    return teams.length === 1 ? this.team(teams[0]) : null;
  }

  get repositoryApproversTeam() {
    const teams = getSpecialTeam(this, 'teamRepoApprovers', 'organization repository approvers');
    if (teams.length > 1) {
      throw new Error('Multiple repository approval teams are not supported.');
    }
    return teams.length === 1 ? this.team(teams[0]) : null;
  }

  get systemSudoersTeam() {
    const teams = getSpecialTeam(this, 'teamPortalSudoers', 'system sudoers');
    if (teams.length > 1) {
      throw new Error('Multiple system sudoer teams are not supported.');
    }
    return teams.length === 1 ? this.team(teams[0]) : null;
  }

  get privateRepositoriesSupported() {
    return getSupportedRepositoryTypesByPriority(this).includes('private');
  }

  get sudoersTeam() {
    const teams = getSpecialTeam(this, 'teamSudoers', 'organization sudoers');
    if (teams.length > 1) {
      throw new Error('Multiple sudoer teams are not supported.');
    }
    return teams.length === 1 ? this.team(teams[0]) : null;
  }

  get specialRepositoryPermissionTeams() {
    return {
      read: getSpecialTeam(this, 'teamAllReposRead', 'read everything'),
      write: getSpecialTeam(this, 'teamAllReposWrite', 'write everything'),
      admin: getSpecialTeam(this, 'teamAllReposAdmin', 'administer everything'),
    };
  }

  getOrganizationAdministrators(callback) {
    // returns an array containing an ID and properties 'owner' and 'sudo' for each
    const self = this;
    const administrators = new Map();
    function getAdministratorEntry(id, login) {
      let administrator = administrators.get(id);
      if (!administrator) {
        administrator = {
          id: id,
          login: login,
          sudo: false,
          owner: false,
        };
        administrators.set(id, administrator);
      }
      return administrator;
    }
    self.getOwners((error, owners) => {
      if (error) {
        return callback(error);
      }
      for (let i = 0; i < owners.length; i++) {
        const id = owners[i].id;
        const login = owners[i].login;
        getAdministratorEntry(id, login).owner = true;
      }
      const sudoTeam = self.sudoersTeam;
      if (!sudoTeam) {
        return callback(null, Array.from(administrators));
      }
      sudoTeam.getMembers((error, members) => {
        if (error && error.code === 404) {
          // The sudo team no longer exists, but we should still have administrator information
          return callback(null, Array.from(administrators));
        }
        if (error) {
          return callback(error);
        }
        for (let i = 0; i < members.length; i++) {
          const id = members[i].id;
          const login = members[i].login;
          getAdministratorEntry(id, login).sudo = true;
        }
        return callback(null, Array.from(administrators.values()));
      });
    });
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

  createRepository(repositoryName, options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = {};
    }

    const self = this;
    const token = this._getOwnerToken();
    const operations = this._operations;

    const orgName = this.name;

    delete options.name;
    delete options.org;

    const parameters = Object.assign({
      org: orgName,
      name: repositoryName,
    }, options);

    return operations.github.post(token, 'repos.createForOrg', parameters, (error, details) => {
      if (error) {
        return callback(wrapError(error, `Could not create the repository ${orgName}/${repositoryName}`));
      }
      const newRepository = self.repositoryFromEntity(details);
      return callback(null, newRepository, details);
    });
  }

  getDetails(callback) {
    const token = this._getOwnerToken();
    const operations = this._operations;
    const parameters = {
      org: this.name,
    };
    return operations.github.call(token, 'orgs.get', parameters, (error, entity) => {
      if (error) {
        return callback(wrapError(error, 'Could not get details about the organization.'));
      }
      callback(null, entity);
    });
  }

  getRepositoryCreateMetadata() {
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
      templates: getRepositoryCreateTemplates(this, operations),
      visibilities: getSupportedRepositoryTypesByPriority(this),
    };
    return metadata;
  }

  getTeamFromName(nameOrSlug, options, callback) {
    const operations = this._operations;
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = {};
    }
    // Slightly more aggressive attempt to look for the latest team
    // information to help prevent downtime when a new team is created
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = operations.defaults.orgTeamsSlugLookupStaleSeconds;
    }
    const expected = nameOrSlug.toLowerCase();
    this.getTeams(options, (teamsError, teams) => {
      if (teamsError) {
        return callback(teamsError);
      }
      let alternativeCandidateById = null;
      for (let i = 0; i < teams.length; i++) {
        const team = teams[i];
        const name = team.name.toLowerCase();
        const slug = team.slug.toLowerCase();
        // Considered a light error condition, this will callback with
        // both a suggestion to redirect to the slug-based name, but
        // also the team instance itself.
        if (expected === name && name !== slug) {
          const redirectError: IRedirectError = new Error(`The team is also available by "slug", ${slug}.`);
          redirectError.status = 301;
          redirectError.slug = slug;
          return callback(redirectError, team);
        }
        if (team.id == expected) {
          alternativeCandidateById = team;
        }
        if (expected === slug) {
          return callback(null, team);
        }
      }
      if (alternativeCandidateById) {
        const redirectError: IRedirectError = new Error(`The team is also available by "slug", ${alternativeCandidateById.slug}.`);
        redirectError.status = 301;
        redirectError.slug = alternativeCandidateById.slug;
        return callback(redirectError, alternativeCandidateById);
      }
      const teamNotFoundError: IReposError = new Error('No team was found within the organization matching the provided name');
      teamNotFoundError.status = 404;
      teamNotFoundError.skipLog = true;
      return callback(teamNotFoundError);
    });
  }

  team(id, optionalEntity?) {
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

  member(id, optionalEntity?) {
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

  getOwners(options, callback?) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    options.role = 'admin';
    return this.getMembers(options, callback);
  }

  isSudoer(username, callback) {
    const sudoerTeam = this.sudoersTeam;
    if (!sudoerTeam) {
      return callback(null, false);
    }

    const appConfig = this._operations.config;
    if (appConfig.github.debug && appConfig.github.debug.orgSudoOff) {
      console.warn('DEBUG WARNING: Organization sudo support is turned off in the current environment');
      return callback(null, false);
    }

    sudoerTeam.getMembershipEfficiently(username, (getMembershipError, membership) => {
      // The team for sudoers may have been deleted, which is not an error
      if (getMembershipError && getMembershipError.code === 404) {
        return callback(null, false);
      }
      if (getMembershipError) {
        return callback(getMembershipError);
      }
      const isKnownMembership = membership === 'member' || membership === 'maintainer';
      if (membership && isKnownMembership) {
        return callback(null, isKnownMembership);
      } else if (membership) {
        return callback(null, new Error(`Cannot determine sudo status for ${username}, unrecognized membership type: ${membership}`));
      } else {
        return callback(null, false);
      }
    });
  }

  acceptOrganizationInvitation(userToken, callback) {
    const operations = this._operations;
    const parameters = {
      org: this.name,
      state: 'active',
    };
    return operations.github.post(userToken, 'users.editOrgMembership', parameters, (error, response) => {
      if (error) {
        return callback(wrapError(error, `Could not accept your invitation for the ${this.name} organization on GitHub`));
      }
      return callback(null, response);
    });
  }

  getMembership(username, options, callback) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};
    const orgName = this.name;
    const parameters = {
      username: username,
      org: orgName,
    };
    const operations = this._operations;
    const token = this._getOwnerToken();
    return operations.github.call(token, 'orgs.getOrgMembership', parameters, (error, result) => {
      if (error && error.code === 404) {
        return callback(null, false);
      }
      if (error) {
        let reason = error.message;
        if (error.code) {
          reason += ' ' + error.code;
        }
        const wrappedError = wrapError(error, `Trouble retrieving the membership for "${username}" in the ${orgName} organization. ${reason}`);
        if (error.code) {
          wrapError['code'] = error.code;
        }
        return callback(wrappedError);
      }
      return callback(null, result);
    });
  }

  getOperationalMembership(username, callback) {
    if (!callback || !username) {
      return callback(new Error('Username and a callback must be provided'));
    }
    // This is a specific version of the getMembership function that takes
    // no options and never allows for caching [outside of the standard
    // e-tag validation with the real-time GitHub API]
    const options = {
      backgroundRefresh: false,
      maxAgeSeconds: -60,
    };
    return this.getMembership(username, options, callback);
  }

  checkPublicMembership(username, options, callback) {
    // NOTE: This method is unable to be cached by the underlying
    // system since there is no etag returned for status code-only
    // results.
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
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
      if (error && error.code === 404) {
        return callback(null, false);
      }
      if (error) {
        return callback(wrapError(error, `Trouble retrieving the public membership status for "${username}" in the ${this.name} organization`));
      }
      return callback(null, true);
    });
  }

  concealMembership(login, userToken, callback) {
    // This call required a provider user token with the expanded write:org scope
    const operations = this._operations;
    const parameters = {
      org: this.name,
      username: login,
    };
    return operations.github.post(userToken, 'orgs.concealMembership', parameters, (error) => {
      return error ? callback(wrapError(error, 'Could not conceal organization membership for ')) : callback();
    });
  }

  publicizeMembership(login, userToken, callback) {
    // This call required a provider user token with the expanded write:org scope
    const operations = this._operations;
    const parameters = {
      org: this.name,
      username: login,
    };
    return operations.github.post(userToken, 'orgs.publicizeMembership', parameters, (error) => {
      return error ? callback(wrapError(error, 'Could not publicize the organization membership for ')) : callback();
    });
  }

  getMembers(options, callback) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};

    let operations = this._operations;
    let token = this._getOwnerToken();
    let github = operations.github;

    let parameters: IGetMembersParameters = {
      org: this.name,
      per_page: 100,
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
    };
    if (options && options.backgroundRefresh === false) {
      caching.backgroundRefresh = false;
    }
    return github.collections.getOrgMembers(
      token,
      parameters,
      caching,
      common.createInstancesCallback(this, this.memberFromEntity, callback));
  }

  getMembersWithoutTwoFactor(options, callback) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    const clonedOptions = Object.assign({
      filter: '2fa_disabled',
    }, options || {});
    return this.getMembers(clonedOptions, callback);
  }

  isMemberSingleFactor(username, options, callback) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    const self = this;
    self.getMembersWithoutTwoFactor(options, (getError, membersWithoutTwoFactor) => {
      if (getError) {
        return callback(getError);
      }
      const lowerCase = username.toLowerCase();
      for (let i = 0; i < membersWithoutTwoFactor.length; i++) {
        const lc = membersWithoutTwoFactor[i].login.toLowerCase();
        if (lowerCase === lc) {
          return callback(null, true);
        }
      }
      return callback(null, false);
    });
  }

  getTeams(options, callback) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};


    let operations = this._operations;
    let token = this._getOwnerToken();
    let github = operations.github;

    let parameters = {
      org: this.name,
      per_page: 100,
    };
    const caching = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.orgTeamsStaleSeconds,
      backgroundRefresh: true,
    };
    caching.backgroundRefresh = options.backgroundRefresh;

    return github.collections.getOrgTeams(
      token,
      parameters,
      caching,
      common.createInstancesCallback(this, this.teamFromEntity, callback));
  }

  removeMember(login, callback) {
    const token = this._getOwnerToken();
    const operations = this._operations;
    const parameters = {
      org: this.name,
      username: login,
    };
    return operations.github.post(token, 'orgs.removeOrgMembership', parameters, (error) => {
      return error ? callback(wrapError(error, 'Could not remove the organization member')) : callback();
    });
  }

  getMembershipInvitations(callback) {
    const token = this._getOwnerToken();
    const operations = this._operations;
    const parameters = {
      org: this.name,
    };
    return operations.github.call(token, 'orgs.getPendingOrgInvites', parameters, (error, invitations) => {
      return error && error.code !== 404 ? callback(wrapError(error, 'Could not retrieve organization invitations')) : callback(null, invitations);
    });
  }

  memberFromEntity(entity) {
    return this.member(entity.id, entity);
  }

  teamFromEntity(entity) {
    return this.team(entity.id, entity);
  }

  repositoryFromEntity(entity) {
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

function getOwnerToken() {
  let tok = this._settings.ownerToken;
  return tok;
}

function getRepositoryCreateTemplates(self, operations) {
  const config = operations.config;
  const templates = [];
  const configuredTemplateRoot = config.github.templates || {};
  const configuredTemplateDefinitions = configuredTemplateRoot && configuredTemplateRoot.definitions ? configuredTemplateRoot.definitions : {};
  const templateDefinitions = configuredTemplateDefinitions || {};
  const allTemplateNames = Object.getOwnPropertyNames(templateDefinitions);
  const ts = self._settings.templates || allTemplateNames;
  const legalEntities = self.legalEntities;
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
    }
  });
  return templates;
}

function getSpecialTeam(self, propertyName, friendlyName, throwIfMissing?) {
  const settings = self._settings;
  if (!settings[propertyName] && throwIfMissing) {
    throw new Error(`Missing configured organization "${self.name}" property ${propertyName} (special team ${friendlyName})`);
  }
  const value = settings[propertyName];
  if (value && Array.isArray(value)) {
    const asNumbers = [];
    for (let i = 0; i < value.length; i++) {
      asNumbers.push(parseInt(value[i], 10));
    }
    return asNumbers;
  }
  const teams = [];
  if (value) {
    teams.push(parseInt(value, 10));
  }
  return teams;
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
}
