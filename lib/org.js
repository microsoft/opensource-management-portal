//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const async = require('async');
const github = require('octonode');
const debug = require('debug')('azureossportal');
const utils = require('../utils');
const Team = require('./team');
const Repo = require('./repo');

function OpenSourceOrganization(ossInstance, name, settings) {
  const self = this;
  self.name = name;
  // CONSIDER: Do not expose.
  self.inner = {
    settings: settings,
    teams: {},
    repos: {},
  };
  self.oss = ossInstance;
  self.baseUrl = self.oss.baseUrl + name + '/';
  self.setting = function (name) {
    var value = self.inner.settings[name];
    if (value === undefined) {
      debug('setting ' + name + ' is undefined!');
    }
    return value;
  };
}

// ----------------------------------------------------------------------------
// Create a GitHub 'octonode' client using our standard owner elevation token
// or an alternate token.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.createGenericGitHubClient = function createGitHubClient(alternateToken) {
  var ownerToken = this.inner.settings.ownerToken;
  if (!ownerToken) {
    throw new Error('No "ownerToken" available for the ' + this.name + ' organization.');
  }
  return github.client(alternateToken || ownerToken);
};

// ----------------------------------------------------------------------------
// With the GitHub OAuth scope of 'write:org', we can accept the invitation for
// the user on their behalf, improving the onboarding workflow from our earlier
// implementation with the invitation dance and hop.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.acceptOrganizationInvitation = function acceptInvite(userToken, callback) {
  if (!userToken) {
    return callback(new Error('No GitHub token available for the user operation.'));
  }
  this.createGenericGitHubClient(userToken).me().updateMembership(this.name, 'active', callback);
};

// ----------------------------------------------------------------------------
// Special Team: "Everyone" team used for handling invites and 2FA checks.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getAllMembersTeam = function (throwIfMissing) {
  return getSpecialTeam(this, 'teamAllMembers', 'all members', throwIfMissing);
};


// ----------------------------------------------------------------------------
// Does this org support CLA features, and are they available?
// 3 possible return values: true, false, 'offline'.
// If the database is down or unavailable at startup, it should not take down
// the entire site. This can help display a message to a user.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.isLegacyClaAutomationAvailable = function() {
  'use strict';
  const claTeams = this.getLegacyClaTeams(false /* do not throw if not configured */);
  if (!claTeams) {
    return false;
  }
  return this.oss.ossDbClient() ? true : 'offline';
};

// ----------------------------------------------------------------------------
// Special Team: "CLA" write teams used for authoring the CLA user to create
// labels and other activities for the legacy CLA project.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getLegacyClaTeams = function (throwIfMissing) {
  'use strict';
  if (throwIfMissing === undefined) {
    throwIfMissing = true;
  }
  let claSettings = this.inner.settings.cla;
  if (!claSettings) {
    const message = `No CLA configurations defined for the ${this.name} org.`;
    if (throwIfMissing === true) {
      throw new Error(message);
    } else {
      debug(message);
      return null;
    }
  }
  let clas = {};
  for (const key in claSettings) {
    clas[key] = this.team(claSettings[key]);
  }
  return clas;
};

// ----------------------------------------------------------------------------
// Special Team: "Repo Approvers" for the repo create workflow.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getRepoApproversTeam = function (throwIfMissing) {
  return getSpecialTeam(this, 'teamRepoApprovers', 'repo create approvers', throwIfMissing);
};

// ----------------------------------------------------------------------------
// Get the highlighted teams for the org, if any.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getHighlightedTeams = function () {
  var highlightedTeams = this.inner.settings.highlightedTeams;
  var teams = [];
  if (Array.isArray(highlightedTeams)) {
    for (var i = 0; i < highlightedTeams.length; i++) {
      var team = this.team(highlightedTeams[i].id);
      teams.push(team);
    }
  }
  return teams;
};

// ----------------------------------------------------------------------------
// Special Team: "All Repos" which receives access to all repos in the org.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getAllRepoReadTeam = function (throwIfMissing) {
  return getSpecialTeam(this, 'teamAllReposRead', 'all repos access team', throwIfMissing);
};

// ----------------------------------------------------------------------------
// Special Team: "All Repo Write" which gives write access to all repos for
// very specific engineering system use cases.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getAllRepoWriteTeam = function (throwIfMissing) {
  return getSpecialTeam(this, 'teamAllReposWrite', 'all repo write team', throwIfMissing);
};

// ----------------------------------------------------------------------------
// Retrieve a user-scoped team object.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.team = function getTeam(id, optionalInitialData) {
  var self = this;
  if (typeof id != 'string') {
    id = id.toString();
  }
  if (self.inner.teams[id]) {
    var team = self.inner.teams[id];
    if (team._detailsLoaded === false && optionalInitialData) {
      team.setDetails(optionalInitialData);
    }
    return team;
  } else {
    self.inner.teams[id] = new Team(self, id, optionalInitialData);
    return self.inner.teams[id];
  }
};

// ----------------------------------------------------------------------------
// Retrieve a user-scoped repo object.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.repo = function getRepo(repoName, optionalInitialData) {
  var self = this;
  var normalized = repoName.toLowerCase();
  if (self.inner.repos[normalized]) {
    return self.inner.repos[normalized];
  } else {
    self.inner.repos[normalized] = new Repo(self, repoName, optionalInitialData);
    return self.inner.repos[normalized];
  }
};

// ----------------------------------------------------------------------------
// Get a repository client for the notifications repo used in the workflow.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getWorkflowRepository = function () {
  var repoName = this.inner.settings.notificationRepo;
  if (!repoName) {
    throw new Error('No workflow/notification repository is defined for the organization.');
  }
  return this.repo(repoName);
};

// ----------------------------------------------------------------------------
// Retrieve a team object by name. To be much more efficient, this should
// actually live in a global memory cache (vs per-user context like the other
// OSS instances). But it works for now.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.teamFromName = function getTeamName(teamName, callback) {
  var self = this;
  this.getTeams(true /* allow caching */, function (error, teams) {
    if (error) {
      return callback(error);
    }
    for (var i = 0; i < teams.length; i++) {
      var name = teams[i].name;
      var slug = teams[i].slug;
      if (name && name.toLowerCase && name.toLowerCase() == teamName.toLowerCase()) {
        var redirectError = null;
        if (name.toLowerCase() != slug.toLowerCase()) {
          redirectError = new Error();
          redirectError.status = 401;
          redirectError.slug = slug;
        }
        return callback(redirectError, teams[i]);
      }
      if (slug && slug.toLowerCase && slug.toLowerCase() == teamName.toLowerCase()) {
        return callback(null, teams[i]);
      }
    }
    // Make a secondary request without caching, to be sure... it may have just
    // been created, for example.
    self.getTeams(false, function (error, teams) {
      if (error) {
        return callback(error);
      }
      for (var i = 0; i < teams.length; i++) {
        var name = teams[i].name;
        if (name && name.toLowerCase && name.toLowerCase() == teamName) {
          return callback(null, teams[i]);
        }
      }
      return callback(null, null);
    });
  });
};

// ----------------------------------------------------------------------------
// SECURITY METHOD:
// Is the user in this context authorized as a sudoer of this organization?
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.isUserSudoer = function (callback) {
  this.getSudoersTeam().isMember(function (error, isMember) {
    if (error) {
      return callback(utils.wrapError(error,
        'We had trouble querying GitHub for important team management ' +
        'information. Please try again later or report this issue.'));
    }
    callback(null, isMember === true);
  });
};

// ----------------------------------------------------------------------------
// Special Team: Sudoers for this specific organization. The members
// of this team have semi-sudoers ability - the ability to maintain their org
// as needed. It is important to notice that the organization that the sudoers
// are in may actually be the primary org and not the leaf node org.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getSudoersTeam = function () {
  var self = this;
  var config = self.inner.settings;
  if (config && config.teamSudoers) {
    return self.team(config.teamSudoers);
  } else {
    throw new Error('Configuration for the sudoers team is missing.');
  }
};

// ----------------------------------------------------------------------------
// Special Team: Portal sudoers. This only applies to the first org.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getPortalSudoersTeam = function () {
  var self = this;
  var config = self.inner.settings;
  if (config && config.teamPortalSudoers) {
    return self.team(config.teamPortalSudoers);
  } else {
    throw new Error('Configuration for the portal sudoers team is missing.');
  }
};

// ----------------------------------------------------------------------------
// Check for public membership
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.queryUserPublicMembership = function getSingleUserMembership(callback) {
  var self = this;
  var ghorg = self.createGenericGitHubClient().org(self.name);
  ghorg.publicMember(self.oss.usernames.github, function (error, result) {
    return callback(null, result === true);
  });
};

// ----------------------------------------------------------------------------
// Make membership public for the authenticated user.
// Requires an expanded GitHub API scope (write:org).
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.setPublicMembership = function goPublic(userToken, callback) {
  var ghorg = this.createGenericGitHubClient(userToken).org(this.name);
  ghorg.publicizeMembership(this.oss.usernames.github, callback);
};

// ----------------------------------------------------------------------------
// Make membership private for the authenticated user.
// Requires an expanded GitHub API scope (write:org).
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.setPrivateMembership = function goPrivate(userToken, callback) {
  var ghorg = this.createGenericGitHubClient(userToken).org(this.name);
  ghorg.concealMembership(this.oss.usernames.github, callback);
};

// ----------------------------------------------------------------------------
// Create a repository on GitHub within this org.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.createRepository = function createRepo(name, properties, callback) {
  if (typeof properties == 'function') {
    callback = properties;
    properties = {};
  }
  var ghorg = this.createGenericGitHubClient().org(this.name);
  var repoProperties = {
    name: name,
  };
  Object.assign(repoProperties, properties);
  ghorg.repo(repoProperties, callback);
};

// ----------------------------------------------------------------------------
// Check for membership (private or public). Use Redis for performance reasons
// and fallback to a live API query for pending/negative results.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.queryUserMembership = function getSingleUserGeneralMembership(allowRedis, callback) {
  var self = this;
  if (typeof allowRedis == 'function') {
    callback = allowRedis;
    allowRedis = true;
  }
  if (allowRedis === true) {
    return self.queryUserMembershipCached(callback);
  }
  self.createGenericGitHubClient().org(self.name).membership(self.oss.usernames.github, function (error, result) {
    if (!(result && result.state && (result.state == 'active' || result.state == 'pending'))) {
      result = false;
    }
    var redisKey = 'user#' + self.oss.id.github + ':org#' + self.name + ':membership';
    self.oss.redis.setObjectWithExpire(redisKey, result, 60 * 48 /* 2 days */, function () {
      callback(null, result);
    });
  });
};

// ----------------------------------------------------------------------------
// Check for membership (private or public) for any GitHub username. Does not
// cache.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.queryAnyUserMembership = function (username, callback) {
  var self = this;
  self.createGenericGitHubClient().org(self.name).membership(username, function (error, result) {
    if (!(result && result.state && (result.state == 'active' || result.state == 'pending'))) {
      result = false;
    }
    callback(null, result);
  });
};

// ----------------------------------------------------------------------------
// Clears the cached state for a user's organization membership value.
// ----------------------------------------------------------------------------
function removeCachedUserMembership(self, callback) {
  var redisKey = 'user#' + self.oss.id.github + ':org#' + self.name + ':membership';
  self.oss.redis.delete(redisKey, function () {
    callback();
  });
}

// ----------------------------------------------------------------------------
// Check for membership (private or public). Use Redis for performance reasons
// (the "active" example) and always fallback to a live API query when needed.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.queryUserMembershipCached = function getSingleUserGeneralMembershipCached(callback) {
  var self = this;
  var redisKey = 'user#' + self.oss.id.github + ':org#' + self.name + ':membership';
  self.oss.redis.getObject(redisKey, function (error, data) {
    if (!error && data && data.state && data.state == 'active') {
      return callback(null, data);
    }
    self.createGenericGitHubClient().org(self.name).membership(self.oss.usernames.github, function (error, result) {
      if (error) {
        error = null;
        result = false;
      }
      self.oss.redis.setObjectWithExpire(redisKey, result, 60 * 48 /* 2 days */, function () {
        callback(null, result);
      });
    });
  });
};

// ----------------------------------------------------------------------------
// Remove the user from the organization.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.removeUserMembership = function dropUser(optionalUsername, callback) {
  var self = this;
  if (typeof optionalUsername == 'function') {
    callback = optionalUsername;
    optionalUsername = self.oss.usernames.github;
  }
  self.createGenericGitHubClient().org(self.name).removeMember(optionalUsername, function (error, result) {
    removeCachedUserMembership(self, function () {
      callback(error, result);
    });
  });
};

// ----------------------------------------------------------------------------
// Retrieve the list of all teams in the organization. This is not specific to
// the user but instead a general query across this org.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getTeams = function getBasicTeamList(allowRedis, callback) {
  var self = this;
  if (typeof allowRedis == 'function') {
    callback = allowRedis;
    allowRedis = true;
  }
  var instancesFromJson = function (teamInstances) {
    async.map(teamInstances, function (teamInstance, cb) {
      cb(null, self.team(teamInstance.id, teamInstance));
    }, callback);
  };
  var redisKey = 'org#' + self.name + ':teams';
  self.oss.redis.getObject(redisKey, function (error, data) {
    if (!error && data && allowRedis === true) {
      return instancesFromJson(data);
    }
    var ghorg = self.createGenericGitHubClient().org(self.name);
    utils.retrieveAllPages(ghorg.teams.bind(ghorg), function (error, teamInstances) {
      if (error) {
        return callback(error);
      }
      self.oss.redis.setObjectWithExpire(redisKey, teamInstances, utils.randomInteger(20, 90), function () {
        instancesFromJson(teamInstances);
      });
    });
  });
};

// ----------------------------------------------------------------------------
// Clear the organization's team list cache.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.clearTeamsCache = function (callback) {
  var redisKey = 'org#' + this.name + ':teams';
  this.oss.redis.delete(redisKey, function () {
    callback();
  });
};

// ----------------------------------------------------------------------------
// Gets all source repos for the organization, supporting e-tag. In time this
// will replace the standard methods once validated.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getReposHighPerformance = function (overrideMaxAge, callback) {
  'use strict';
  // OVERRIDE MAX AGE IS NOT LONG-TERM
  if (!callback && typeof (overrideMaxAge) === 'function') {
    callback = overrideMaxAge;
    overrideMaxAge = 60 * 15; /* 15m in seconds */
  }
  const token = this.inner.settings.ownerToken;
  const options = {
    org: this.name,
    type: 'all',
    per_page: 100,
  };
  const cacheOptions = {
    maxAgeSeconds: overrideMaxAge,
    backgroundRefresh: true,
  };
  return this.oss.githubLibrary.collections.getOrgRepos(token, options, cacheOptions, callback);
};

// ----------------------------------------------------------------------------
// Gets all source repos for the organization.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getRepos = function getRepos(allowRedis, callback) {
  var self = this;
  if (typeof allowRedis == 'function') {
    callback = allowRedis;
    allowRedis = true;
  }
  var instancesFromJson = function (repos) {
    async.map(repos, function (repo, cb) {
      cb(null, self.repo(repo.name, repo));
    }, callback);
  };
  var redisKey = 'org#' + self.name + ':repos';
  self.oss.redis.getObject(redisKey, function (error, data) {
    if (!error && data && allowRedis === true) {
      return instancesFromJson(data);
    }
    var ghorg = self.createGenericGitHubClient().org(self.name);
    utils.retrieveAllPages(ghorg.repos.bind(ghorg), {
      'type': 'sources',
    }, function (error, repos) {
      if (error) {
        return callback(error);
      }
      self.oss.redis.setObjectWithExpire(redisKey, repos, utils.randomInteger(30, 60 * 12), function () {
        instancesFromJson(repos);
      });
    });
  });
};

// ----------------------------------------------------------------------------
// Gets a list of team memberships for the authenticated user. This is a slower
// implementation than the GitHub API provides, since that requires additional
// authenticated scope, which our users have had negative feedback about
// requiring. Instead, this uses an org-authorized token vs the user's.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getMyTeamMemberships = function (role, alternateUserId, callback) {
  var self = this;
  if (typeof alternateUserId == 'function') {
    callback = alternateUserId;
    alternateUserId = self.oss.id.github;
  }
  self.getTeams(function (error, teams) {
    if (error) {
      return callback(error);
    }
    var myTeams = [];
    async.each(teams, function (team, callback) {
      team.getMembersCached(role, function (error, members) {
        if (error) {
          return callback(error);
        }
        for (var i = 0; i < members.length; i++) {
          var member = members[i];
          if (member.id == alternateUserId) {
            myTeams.push(team);
            break;
          }
        }
        callback();
      });
    }, function (error) {
      callback(error, myTeams);
    });
  });
};

// ----------------------------------------------------------------------------
// v.Next implementation
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getTeamsHighPerformance = function (callback) {
  'use strict';
  const self = this;
  const token = this.inner.settings.ownerToken;
  const options = {
    org: this.name,
    per_page: 100,
  };
  const cacheOptions = {
    maxAgeSeconds: 60 * 15, /* 15m */
    backgroundRefresh: true,
  };
  const instancesFromJson = function (error, teamInstances) {
    if (error) {
      return callback(error);
    }
    async.map(teamInstances, function (teamInstance, cb) {
      cb(null, self.team(teamInstance.id, teamInstance));
    }, callback);
  };
  return this.oss.githubLibrary.collections.getOrgTeams(token, options, cacheOptions, instancesFromJson);
};

// ----------------------------------------------------------------------------
// Builds a hash mapping organization member's GitHub user IDs to a cached
// member object. This version actually walks all of the teams, which is a
// super CPU-intensive way to do this, but it makes some use of Redis. Need
// to fix that someday and cache the whole thing probably.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getAllMembersById = function (callback) {
  var self = this;
  var memberHash = {};
  self.getTeams(function (error, teams) {
    if (error) {
      return callback(error);
    }
    async.each(teams, function (team, callback) {
      team.getMembersCached('all', function (error, members) {
        if (error) {
          return callback(error);
        }
        for (var i = 0; i < members.length; i++) {
          var member = members[i];
          if (memberHash[member.id] === undefined) {
            memberHash[member.id] = member;
          }
        }
        callback();
      });
    }, function (error) {
      callback(error, memberHash);
    });
  });
};

// ----------------------------------------------------------------------------
// Retrieve the list of all accounts in the org that do not have multi-factor
// (modern security) auth turned on. Uses the GitHub API. This version uses a
// cache to speed up the use of the site.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getAuditListCached = function getAuditListCached(callback) {
  var self = this;
  var redisKey = 'org#' + self.name + ':2fa-disabled';
  var ghorg = this.createGenericGitHubClient().org(this.name);
  self.oss.redis.getObject(redisKey, function (error, data) {
    if (!error && data) {
      return mapUsernameToId(data, callback);
    }
    utils.retrieveAllPages(ghorg.members.bind(ghorg), { filter: '2fa_disabled' }, function (error, people) {
      if (error) {
        return callback(error);
      }
      self.oss.redis.setObjectWithExpire(redisKey, people, 60 * 48 /* 2 days */, function () {
        mapUsernameToId(people, callback);
      });
    });
  });
};

// ----------------------------------------------------------------------------
// Retrieve a hash, by username, of all admins for the organization.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getAdministratorsHashCached = function getAdminsCached(callback) {
  var self = this;
  var redisKey = 'org#' + self.name + ':admins';
  var ghorg = this.createGenericGitHubClient().org(this.name);
  self.oss.redis.getObject(redisKey, function (error, data) {
    if (!error && data) {
      return mapUsernameToId(data, callback);
    }
    utils.retrieveAllPages(ghorg.members.bind(ghorg), { role: 'admin' }, function (error, people) {
      if (error) {
        return callback(error);
      }
      self.oss.redis.setObjectWithExpire(redisKey, people, 60 * 48 /* 2 days */, function () {
        mapUsernameToId(people, callback);
      });
    });
  });
};

// ----------------------------------------------------------------------------
// Check whether this user has multi-factor authentication turned on. Returns
// true for a user in good standing.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.queryUserMultifactorStateOk = function getSingleUserMfaState(callback) {
  var self = this;
  self.getAuditList(function (error, list) {
    if (error) {
      return callback(utils.wrapError(error, 'A problem occurred while trying to query important information about the org.'));
    }
    var twoFactorOff = list[self.oss.usernames.github.toLowerCase()] !== undefined;
    callback(null, twoFactorOff === false);
  });
};

// ----------------------------------------------------------------------------
// Check whether this user has multi-factor authentication turned on. Returns
// true for a user in good standing. Uses the cache initially. If the cache
// result implies that this user may not be in compliance, we reach out with a
// real GitHub API request, resetting the cache and writing the results. This
// was the user only receives false in the case of an API failure or actually
// not having multifactor authentication turned on.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.queryUserMultifactorStateOkCached = function getSingleUserMfaStateCached(callback) {
  var self = this;
  self.getAuditListCached(function (error, list) {
    if (error) {
      return callback(utils.wrapError(error, 'A problem occurred while trying to query important information about the org.'));
    }
    var twoFactorOff = list[self.oss.usernames.github.toLowerCase()] !== undefined;
    if (twoFactorOff === false) {
      return callback(null, true);
    }
    // Go to the live version of the app...
    self.getAuditList(function (error, list) {
      if (error) {
        return callback(utils.wrapError(error, 'A problem occurred while trying to read the current authentication state for your account. Please check that you have turned multifactor authentication on for your GitHub account - thanks.'));
      }
      var twoFactorOff = list[self.oss.usernames.github.toLowerCase()] !== undefined;
      callback(null, twoFactorOff === false);
    });
  });
};

// ----------------------------------------------------------------------------
// Retrieve the list of all accounts in the org that do not have multi-factor
// (modern security) auth turned on. Uses the GitHub API.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getAuditList = function getAuditList(callback) {
  var self = this;
  var ghorg = this.createGenericGitHubClient().org(this.name);
  utils.retrieveAllPages(ghorg.members.bind(ghorg), { filter: '2fa_disabled' }, function (error, people) {
    if (error) {
      return callback(error);
    }
    // Cache the result, updating the org-wide view...
    var redisKey = 'org#' + self.name + ':2fa-disabled';
    self.oss.redis.setObjectWithExpire(redisKey, people, 60 * 48 /* 2 days */, function () {
      mapUsernameToId(people, callback);
    });
  });
};

// ----------------------------------------------------------------------------
// Clear the cached MFA list for this organization.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.clearAuditList = function clearAuditList(callback) {
  var self = this;
  var redisKey = 'org#' + self.name + ':2fa-disabled';
  self.oss.redis.delete(redisKey, function () {
    callback();
  });
};

// ----------------------------------------------------------------------------
// Get the cached high-level information from GitHub for this organization.
// Unlike the team and user objects, these properties are simply returned to
// the caller and not merged into the type and its values.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getDetails = function getOrgDetails(allowRedis, callback) {
  var self = this;
  if (typeof allowRedis == 'function') {
    callback = allowRedis;
    allowRedis = true;
  }
  var redisKey = 'org#' + self.name + ':details';
  self.oss.redis.getObject(redisKey, function (error, data) {
    if (!error && data && allowRedis === true) {
      return callback(null, data);
    }
    var ghorg = self.createGenericGitHubClient().org(self.name);
    ghorg.info(function (error, info) {
      if (error) {
        return callback(utils.wrapError(error, 'The GitHub API had trouble returning information about the organization ' + self.name));
      }
      self.oss.redis.setObjectWithExpire(redisKey, info, utils.randomInteger(60 * 24, 60 * 24 * 2), function () {
        callback(null, info);
      });
    });
  });
};


// ----------------------------------------------------------------------------
// Gets the organization's psuedo-user account details from GitHub.
// ----------------------------------------------------------------------------
OpenSourceOrganization.prototype.getOrganizationUserProfile = function getOrganizationUserProfile(callback) {
  var self = this;
  this.getDetails(function (error, details) {
    if (error || !details) {
      return callback(utils.wrapError(error, 'We had trouble retrieving the profile of the ' + self.name + ' organization from GitHub.'));
    }
    var user = self.oss.user(details.id, details);
    callback(null, user);
  });
};

// ----------------------------------------------------------------------------
// Private: Project a team members list to a dictionary of username:id.
// ----------------------------------------------------------------------------
function mapUsernameToId(people, callback) {
  var projected = {};
  async.each(people, function (person, cb) {
    if (person.id && person.login && person.login.toLowerCase) {
      projected[person.login.toLowerCase()] = person.id;
    }
    cb();
  }, function (error) {
    callback(error, error ? undefined : projected);
  });
}

// ----------------------------------------------------------------------------
// Private: get a special team instance
// ----------------------------------------------------------------------------
function getSpecialTeam(org, configName, prettyName, throwIfMissing) {
  if (throwIfMissing === undefined) {
    throwIfMissing = true;
  }
  var mySettings = org.inner.settings;
  if (mySettings[configName]) {
    return org.team(mySettings[configName]);
  } else {
    var message = 'Configuration is missing. The "' + prettyName + '" team is not defined.';
    if (throwIfMissing === true) {
      throw new Error(message);
    } else {
      debug(message);
      return null;
    }
  }
}

module.exports = OpenSourceOrganization;
