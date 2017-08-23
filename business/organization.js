//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

const _ = require('lodash');

const common = require('./common');
const wrapError = require('../utils').wrapError;

const OrganizationMember = require('./organizationMember');
const Repository = require('./repository');
const Team = require('./team');

const legacyClaIntegration = require('./legacyClaIntegration');

class Organization {
  constructor(operations, name, settings) {
    this.name = settings.name || name;
    this.baseUrl = operations.baseUrl + this.name + '/';

    const privates = _private(this);
    privates.operations = operations;
    privates.settings = settings;
    privates.getOwnerToken = getOwnerToken.bind(this);
  }

  repository(name, optionalEntity) {
    let entity = optionalEntity || {};
    if (!optionalEntity) {
      entity.name = name;
    }
    const repository = new Repository(
      this,
      entity,
      _private(this).getOwnerToken,
      _private(this).operations);
    // CONSIDER: Cache any repositories in the local instance
    return repository;
  }

  getRepositories(options, callback) {
    if (!callback && typeof (options) === 'function') {
      callback = options;
      options = null;
    }
    options = options || {};

    let privates = _private(this);
    let operations = privates.operations;
    let token = privates.getOwnerToken();
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
    const repoName = _private(this).settings.notificationRepo;
    if (!repoName) {
      throw new Error('No workflow/notification repository is defined for the organization.');
    }
    return this.repository(repoName);
  }

  get priority() {
    return _private(this).settings.priority || 'primary';
  }

  get locked() {
    return _private(this).settings.locked || false;
  }

  get createRepositoriesOnGitHub() {
    return _private(this).settings.createReposDirect || false;
  }

  get configuredOrganizationRepositoryTypes() {
    return _private(this).settings.type || 'public';
  }

  get legacyTrainingResourcesLink() {
    return _private(this).settings.trainingResources;
  }

  get privateEngineering() {
    return _private(this).settings.privateEngineering || false;
  }

  get externalMembersPermitted() {
    return _private(this).settings.externalMembersPermitted || false;
  }

  get preventLargeTeamPermissions() {
    return _private(this).settings.preventLargeTeamPermissions || false;
  }

  get description() {
    return _private(this).settings.description;
  }

  get webhookSharedSecrets() {
    const privates = _private(this);
    const orgSettings = privates.settings;

    // Multiple shared can be specified at the organization level to allow for rotation
    let orgSpecificSecrets = orgSettings.hookSecrets || [];

    const systemwideConfig = privates.operations.config;
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
    const settings = _private(this).settings;
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
    const settings = _private(this).settings;
    return settings.cla;
  }

  getRepositoryCreateGitHubToken() {
    // This method leaks/releases the owner token. In the future a more crisp
    // way of accomplishing this without exposing the token should be created.
    // The function name is specific to the intended use instead of a general-
    // purpose token name.
    return _private(this).getOwnerToken();
  }

  createRepository(repositoryName, options, callback) {
    if (!callback && typeof(options) === 'function') {
      callback = options;
      options = {};
    }

    const self = this;
    const token = _private(this).getOwnerToken();
    const operations = _private(this).operations;

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
    const token = _private(this).getOwnerToken();
    const operations = _private(this).operations;
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
    const operations = _private(this).operations;
    const settings = _private(this).settings;
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
    const operations = _private(this).operations;
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
          const redirectError = new Error(`The team is also available by "slug", ${slug}.`);
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
        const redirectError = new Error(`The team is also available by "slug", ${alternativeCandidateById.slug}.`);
        redirectError.status = 301;
        redirectError.slug = alternativeCandidateById.slug;
        return callback(redirectError, alternativeCandidateById);
      }
      const teamNotFoundError = new Error('No team was found within the organization matching the provided name');
      teamNotFoundError.status = 404;
      teamNotFoundError.skipLog = true;
      return callback(teamNotFoundError);
    });
  }

  team(id, optionalEntity) {
    let entity = optionalEntity || {};
    if (!optionalEntity) {
      entity.id = id;
    }
    const team = new Team(
      this,
      entity,
      _private(this).getOwnerToken,
      _private(this).operations);
    // CONSIDER: Cache any teams in the local instance
    return team;
  }

  member(id, optionalEntity) {
    let entity = optionalEntity || {};
    if (!optionalEntity) {
      entity.id = id;
    }
    const member = new OrganizationMember(
      this,
      entity,
      _private(this).getOwnerToken,
      _private(this).operations);
    // CONSIDER: Cache any members in the local instance
    return member;
  }

  getOwners(options, callback) {
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

    const appConfig = _private(this).operations.config;
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
    const operations = _private(this).operations;
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
    const privates = _private(this);
    const operations = privates.operations;
    const token = privates.getOwnerToken();
    return operations.github.call(token, 'orgs.getOrgMembership', parameters, (error, result) => {
      if (error && error.code === 404) {
        return callback(null, false);
      }
      if (error) {
        const wrappedError = wrapError(error, `Trouble retrieving the membership for "${username}" in the ${this.name} organization`);
        if (error.code) {
          wrappedError.code = error.code;
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
    const parameters = {
      username: username,
      org: this.name,
    };
    const privates = _private(this);
    const operations = privates.operations;
    const token = privates.getOwnerToken();
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
    const operations = _private(this).operations;
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
    const operations = _private(this).operations;
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

    let privates = _private(this);
    let operations = privates.operations;
    let token = privates.getOwnerToken();
    let github = operations.github;

    let parameters = {
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

    let privates = _private(this);
    let operations = privates.operations;
    let token = privates.getOwnerToken();
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
    const token = _private(this).getOwnerToken();
    const operations = _private(this).operations;
    const parameters = {
      org: this.name,
      username: login,
    };
    return operations.github.post(token, 'orgs.removeOrgMembership', parameters, (error) => {
      return error ? callback(wrapError(error, 'Could not remove the organization member')) : callback();
    });
  }

  getMembershipInvitations(callback) {
    const token = _private(this).getOwnerToken();
    const operations = _private(this).operations;
    const parameters = {
      org: this.name,
    };
    return operations.github.call(token, 'orgs.getPendingOrgInvites', parameters, (error, invitations) => {
      return error ? callback(wrapError(error, 'Could not retrieve organization invitations')) : callback(null, invitations);
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
  // Does this org support CLA features, and are they available?
  // 3 possible return values: true, false, 'offline'.
  // If the database is down or unavailable at startup, it should not take down
  // the entire site. This can help display a message to a user.
  // ----------------------------------------------------------------------------
  isLegacyClaAutomationAvailable() {
    const settings = _private(this).settings;
    const operations = _private(this).operations;
    return legacyClaIntegration.isAvailableForOrganization(operations, this, settings);
  }

  // ----------------------------------------------------------------------------
  // Special Team: "CLA" write teams used for authoring the CLA user to create
  // labels and other activities for the legacy CLA project.
  // ----------------------------------------------------------------------------
  getLegacyClaTeams(throwIfMissing) {
    const settings = _private(this).settings;
    const operations = _private(this).operations;
    return legacyClaIntegration.getOrganizationTeams(operations, this, settings, throwIfMissing);
  }

  getLegacySystemObjects() {
    const settings = _private(this).settings;
    const operations = _private(this).operations;
    return [settings, operations];
  }
}

function getSupportedRepositoryTypesByPriority(self) {
  // Returns the types of repositories supported by the configuration for the organization.
  // The returned array position 0 represents the recommended default choice for new repos.
  // Note that while the configuration may say 'private', the organization may not have
  // a billing relationship, so repo create APIs would fail asking you to upgrade to a paid
  // plan.
  const settings = _private(self).settings;
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
  let tok = _private(this).settings.ownerToken;
  return tok;
}

function getRepositoryCreateTemplates(self, operations) {
  const config = operations.config;
  const templates = [];
  const templateDefinitions = config.github.templates || {};
  const allTemplateNames = Object.getOwnPropertyNames(templateDefinitions);
  const ts = _private(self).settings.templates || allTemplateNames;
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

module.exports = Organization;

function getSpecialTeam(self, propertyName, friendlyName, throwIfMissing) {
  const settings = _private(self).settings;
  if (!settings[propertyName] && throwIfMissing) {
    throw new Error(`Missing configured organization "${self.name}" property ${propertyName} (special team ${friendlyName})`);
  }
  const value = settings[propertyName];
  if (value && Array.isArray(value)) {
    return value;
  }
  const teams = [];
  if (value) {
    teams.push(parseInt(value, 10));
  }
  return teams;
}

const privateSymbol = Symbol();
function _private(self) {
  if (self[privateSymbol] === undefined) {
    self[privateSymbol] = {};
  }
  return self[privateSymbol];
}
