//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

const async = require('async');
const debug = require('debug')('azureossportal');
const utils = require('../utils');
const github = require('octonode');
const insights = require('./insights');
const sortBy = require('lodash').sortBy;

const Org = require('./org');
const Team = require('./team');
const User = require('./user');
const RedisHelper = require('./redis');

/*eslint no-console: ["error", { allow: ["warn"] }] */

function OpenSourceUserContext(options, callback) {
  var self = this;
  self.displayNames = {
    github: null,
    azure: null,
  };
  self.usernames = {
    github: null,
    azure: null,
  };
  self.avatars = {
    github: null,
  };
  self.id = {
    github: null,
    aad: null,
  };
  self.entities = {
    link: null,
    primaryMembership: null,
  };
  self.tokens = {
    github: null,
    githubIncreasedScope: null,
  };
  self.githubLibrary = options.githubLibrary;
  const applicationConfiguration = options.config;
  const dataClient = options.dataClient;
  const redisInstance = options.redisClient;
  let redisHelper = options.redisHelper;
  const ossDbClient = options.ossDbClient;
  const link = options.link;
  this.insights = options.insights;
  if (this.insights === undefined) {
    this.insights = insights();
  }
  let modernUser;
  this.cache = {
    orgs: {},
    users: {},
  };
  this.modernUser = function () {
    return modernUser;
  };
  this.createModernUser = function (id, login) {
    modernUser = new User(this, id);
    modernUser.login = login;
    return modernUser;
  };
  this.setting = function (name) {
    return applicationConfiguration[name];
  };
  this.dataClient = function () {
    return dataClient;
  };
  this.redisClient = function () {
    return redisInstance;
  };
  this.ossDbClient = function () {
    return ossDbClient;
  };
  this.configuration = applicationConfiguration;
  this.baseUrl = '/';
  if (redisHelper) {
    this.redis = redisHelper;
  } else if (applicationConfiguration && applicationConfiguration.redis) {
    this.redis = new RedisHelper(redisInstance, applicationConfiguration.redis.prefix);
  }
  if (link && options.request) {
    return callback(new Error('The context cannot be set from both a request and a link instance.'));
  }
  if (link) {
    return self.setPropertiesFromLink(link, callback);
  }
  if (options.request) {
    return this.resolveLinkFromRequest(options.request, callback);
  }
  callback(new Error('Could not initialize the context for the acting user.'), self);
}

OpenSourceUserContext.prototype.setPropertiesFromLink = function (link, callback) {
  this.usernames.github = link.ghu;
  this.id.github = link.ghid.toString();
  this.id.aad = link.aadoid;
  this.usernames.azure = link.aadupn;
  this.entities.link = link;
  this.displayNames.azure = link.aadname;
  this.avatars.github = link.ghavatar;
  this.tokens.github = link.githubToken;
  this.tokens.githubIncreasedScope = link.githubTokenIncreasedScope;
  var modernUser = this.modernUser();
  if (!modernUser && this.id.github) {
    modernUser = this.createModernUser(this.id.github, this.usernames.github);
  }
  modernUser.link = link;
  callback(null, this);
};

function tooManyLinksError(self, userLinks, callback) {
  const tooManyLinksError = new Error(`This account has ${userLinks.length} linked GitHub accounts.`);
  tooManyLinksError.links = userLinks;
  tooManyLinksError.tooManyLinks = true;
  return callback(tooManyLinksError, self);
}

function existingGitHubIdentityError(self, link, requestUser, callback) {
  const endUser = requestUser.azure.displayName || requestUser.azure.username;
  const anotherGitHubAccountError = new Error(`${endUser}, there is a different GitHub account linked to your corporate identity.`);
  anotherGitHubAccountError.anotherAccount = true;
  anotherGitHubAccountError.link = link;
  anotherGitHubAccountError.skipLog = true;
  return callback(anotherGitHubAccountError, self);
}

function redisKeyForLink(authenticationScheme, identifier) {
  return `user#${authenticationScheme}:${identifier}:link`;
}

OpenSourceUserContext.prototype.invalidateLinkCache = function (scheme, oid, callback) {
  if (typeof scheme === 'function' && !callback) {
    callback = scheme;
    scheme = this.setting('authentication').scheme;
    oid = this.id.aad;
  }
  if (!oid) {
    return callback(new Error('No AAD ID is available for the user to invalidate the cache.'));
  }
  if (scheme !== 'aad') {
    return callback(new Error(`The scheme ${scheme} is not supported by the cache system at this time.`));
  }
  invalidateCachedLink(this, scheme, oid, callback);
};

function invalidateCachedLink(self, authenticationScheme, identifier, callback) {
  if (!self.redis) {
    return callback(new Error('No Redis instance provided to the user context.'));
  }
  self.redis.delete(redisKeyForLink(authenticationScheme, identifier), callback);
}

function tryGetCachedLink(self, authenticationScheme, identifier, callback) {
  if (!self.redis) {
    console.warn('No Redis client provided with the context object.');
    return callback();
  }
  self.redis.getObject(redisKeyForLink(authenticationScheme, identifier), callback);
}

function tryCacheLink(self, authenticationScheme, identifier, link, multipleLinksPresent, callback) {
  if (!self.redis) {
    console.warn('No Redis client provided with the context object.');
    if (callback) return callback();
  }
  if (multipleLinksPresent) {
    return callback(null, self);
  }
  self.redis.setObjectWithExpire(redisKeyForLink(authenticationScheme, identifier), link, 180 /* minutes */, () => {
    callback(null, self);
  });
}

// ----------------------------------------------------------------------------
// Populate the user's OSS context object.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.resolveLinkFromRequest = function (request, callback) {
  const self = this;
  const requestUser = request.user;
  const scheme = self.setting('authentication').scheme;
  if (requestUser && requestUser.github) {
    self.usernames.github = requestUser.github.username;
    self.id.github = requestUser.github.id;
    self.displayNames.github = requestUser.github.displayName;
    self.avatars.github = requestUser.github.avatarUrl;
  }
  if (requestUser && requestUser.azure) {
    self.usernames.azure = requestUser.azure.username;
    self.displayNames.azure = requestUser.azure.displayName;
    self.id.aad = requestUser.azure.oid;
  }
  if (scheme === 'aad' && requestUser.azure && requestUser.azure.oid) {
    const getUserCacheStartTime = Date.now();
    return tryGetCachedLink(self, 'aad', requestUser.azure.oid, (getCachedLinkError, cachedLink) => {
      const getUserCacheEndTime = Date.now();
      if (self.insights) {
        self.insights.trackDependency('AzureLinksCache', 'getUserByAadId', getUserCacheEndTime - getUserCacheStartTime, !getCachedLinkError);
      }
      if (getCachedLinkError) {
        return callback(getCachedLinkError);
      }
      const selectedId = scheme === 'aad' && request.session && request.session.selectedGithubId ? request.session.selectedGithubId : undefined;
      const validateAndSetOneLink = (link, next) => {
        if (!selectedId && requestUser.github && requestUser.github.username && link.ghu !== requestUser.github.username && link.ghid !== requestUser.github.id) {
          existingGitHubIdentityError(self, link, requestUser, next);
        } else {
          self.setPropertiesFromLink(link, next);
        }
      };
      if (cachedLink) {
        return validateAndSetOneLink(cachedLink, callback);
      }
      const getUserStartTime = Date.now();
      self.dataClient().getUserByAadOid(requestUser.azure.oid, function (findError, userLinks) {
        const getUserEndTime = Date.now();
        if (self.insights) {
          self.insights.trackDependency('AzureLinksTable', 'getUserByAadOid', getUserEndTime - getUserStartTime, !findError);
        }
        if (findError) {
          const wrappedError = utils.wrapError(findError, 'There was a problem trying to load the link from storage.');
          if (findError.message) {
            wrappedError.detailed = findError.message;
          }
          return callback(wrappedError, self);
        }
        if (userLinks.length === 0) {
          return callback(null, self);
        }
        let selectedLink = null;
        if (selectedId) {
          userLinks.forEach((oneLink) => {
            if (oneLink.ghid === selectedId) {
              selectedLink = oneLink;
            }
          });
          if (!selectedLink) {
            delete request.session.selectedGithubId;
          }
        }
        if (!selectedLink) {
          if (userLinks.length > 1) {
            return tooManyLinksError(self, userLinks, callback);
          }
          selectedLink = userLinks[0];
        }
        validateAndSetOneLink(selectedLink, (validationError) => {
          if (validationError) {
            return callback(validationError, self);
          }
          tryCacheLink(self, 'aad', requestUser.azure.oid, selectedLink, selectedId !== undefined, callback);
        });
      });
    });
  }
  let userObject;
  if (self.id.github) {
    userObject = self.createModernUser(self.id.github, self.usernames.github);
  }
  if (!userObject) {
    return callback(new Error('There\'s a logic bug in the user context object. We cannot continue.'), self);
  }
  userObject.getLink(function (error, link) {
    if (error) {
      return callback(utils.wrapError(error, 'We were not able to retrieve information about any link for your user account at this time.'), self);
    }
    if (link) {
      return self.setPropertiesFromLink(link, callback);
    } else {
      callback(null, self);
    }
  });
};

// ----------------------------------------------------------------------------
// SECURITY METHOD:
// Determine whether the authenticated user is an Administrator of the org. At
// this time there is a special "portal sudoers" team that is used. The GitHub
// admin flag is not used [any longer] for performance reasons to reduce REST
// calls to GitHub.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.isPortalAdministrator = function (callback) {
  if (this.configuration.github.debug && this.configuration.github.debug.portalSudoOff) {
    console.warn('DEBUG WARNING: Portal sudo support is turned off in the current environment');
    return callback(null, false);
  }
  /*
  var self = this;
  if (self.entities && self.entities.primaryMembership) {
      var pm = self.entities.primaryMembership;
      if (pm.role && pm.role === 'admin') {
          return callback(null, true);
      }
  }
  */
  const primaryOrg = this.primaryOrg();
  const sudoTeam = primaryOrg.getPortalSudoersTeam();
  if (!sudoTeam) {
    return callback(null, false);
  }
  sudoTeam.isMember(function (error, isMember) {
    if (error) {
      return callback(utils.wrapError(error,
        'We had trouble querying GitHub for important team management ' +
        'information. Please try again later or report this issue.'));
    }
    callback(null, isMember === true);
  });
};

// ----------------------------------------------------------------------------
// Create a simple GitHub client. Should be audited, since using this library
// directly may result in methods which are not cached, etc.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.createGenericGitHubClient = function () {
  const ownerToken = this.org().setting('ownerToken');
  if (!ownerToken) {
    throw new Error('No "ownerToken" set for the ' + this.org().name + ' organization.');
  }
  return github.client(ownerToken);
};

// ----------------------------------------------------------------------------
// Given a GitHub user ID, get their GitHub profile information. Resilient to
// GitHub username changes.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getGithubUsernameFromId = function (id, callback) {
  this.createGenericGitHubClient().get(`/user/${id}`, (error, s, b, h) => {
    if (error) {
      return callback(error.statusCode === 404 ? utils.wrapError(error, `The GitHub user ID ${id} no longer exists on GitHub.com. (404 Not Found)`) : error);
    }
    if (s !== 200) {
      return callback(new Error(`Could not retrieve the GitHub username from the ID ${id}.`));
    } else {
      return callback(null, b.login, h, b);
    }
  });
};

// ----------------------------------------------------------------------------
// Make sure system links are loaded for a set of users.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getLinksForUsers = function (list, callback) {
  const dc = this.dataClient();
  async.map(list, function (person, cb) {
    if (person && person.id) {
      cb(null, person.id);
    } else {
      cb(new Error('No ID known for this person instance.'));
    }
  }, function (error, map) {
    if (error) {
      return callback(error);
    }
    // In large organizations, we will have trouble getting this much data back
    // all at once.
    const groups = [];
    let j = 0;
    const perGroup = 200;
    let group = [];
    for (let i = 0; i < map.length; i++) {
      if (j++ == perGroup) {
        groups.push(group);
        group = [];
        j = 0;
      }
      group.push(map[i]);
    }
    if (group.length > 0) {
      groups.push(group);
      group = [];
    }
    async.each(groups, function (userGroup, cb) {
      dc.getUserLinks(userGroup, function (error, links) {
        if (error) {
          // Specific to problems we've had with storage results...
          if (error.headers && error.headers.statusCode && error.headers.body) {
            let oldError = error;
            error = new Error('Storage returned an HTTP ' + oldError.headers.statusCode + '.');
            error.innerError = oldError;
          }
          return cb(error);
        }
        for (let i = 0; i < list.length; i++) {
          list[i].trySetLinkInstance(links, true);
        }
        cb();
      });
    }, function (error) {
      callback(error ? error : null, error ? null : list);
    });
  });
};

// ----------------------------------------------------------------------------
// Translate a list of IDs into developed objects and their system links.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getUsersAndLinksFromIds = function (list, callback) {
  const self = this;
  for (let i = 0; i < list.length; i++) {
    const id = list[i];
    list[i] = self.user(id);
  }
  self.getLinksForUsers(list, callback);
};

// ----------------------------------------------------------------------------
// Translate a hash of IDs to usernames into developed objects, system links
// and details loaded. Hash key is username, ID is the initial hash value.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getCompleteUsersFromUsernameIdHash = function (hash, callback) {
  const self = this;
  const users = {};
  const list = [];
  for (const key in hash) {
    const id = hash[key];
    const username = key;
    const user = self.user(id);
    user.login = username;
    users[username] = user;
    list.push(user);
  }
  async.parallel([
    function (cb) {
      self.getLinksForUsers(list, cb);
    },
    function (cb) {
      async.each(list, function (user, innerCb) {
        user.getDetailsByUsername(function (/* formerUserError */) {
          // Ignore the user with an error... this means they left GitHub.
          // TODO: Should anything be done or reacted to in this scenario?
          innerCb();
        });
      }, function (error) {
        cb(error);
      });
    },
  ], function (error) {
    callback(error, users);
  });
};

// ----------------------------------------------------------------------------
// Returns a list of users pending removal based on the Redis key of the name
// "pendingunlinks".
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getPendingUnlinks = function getPendingUnlinks(callback) {
  var self = this;
  var dc = this.dataClient();
  var redisKey = 'pendingunlinks';
  self.redis.getSet(redisKey, function (err, upns) {
    if (err) {
      return callback(err);
    }
    var links = [];
    var notFound = [];
    async.each(upns, function (upn, cb) {
      dc.getUserByAadUpn(upn, function (err, user) {
        if (err) {
          return cb(err);
        }
        if (user && user.length && user.length > 0) {
          for (var i = 0; i < user.length; i++) {
            links.push(user[i]);
          }
        } else {
          notFound.push(upn);
        }
        cb();
      });
    }, function (error) {
      callback(error, links, notFound);
    });
  });
};

// ----------------------------------------------------------------------------
// This function is involved and will perform a number of queries across all of
// the registered organizations in the portal. It is designed to try to make as
// much progress as necessary per participant, so that even if the function has
// 50 users to process but can only successfully perform 1 drop, it will get
// the 1 drop done and removed from the Redis set.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.processPendingUnlinks = function processPendingUnlinks(callback) {
  var self = this;
  this.getPendingUnlinks(function (error, unlinks, unknownUsers) {
    if (error) {
      return callback(error);
    }
    var history = {};
    if (unknownUsers && unknownUsers.length && unknownUsers.length > 0) {
      history.unknown = unknownUsers;
    }
    async.eachSeries(unlinks, function (link, cb) {
      var upn = link.aadupn;
      self.processPendingUnlink(link, function (err, info) {
        if (err) {
          return cb(err);
        }
        if (!history.unlinked) {
          history.unlinked = {};
        }
        history.unlinked[upn] = info;
        cb();
      });
    }, function (error) {
      callback(error, history);
    });
  });
};

// ----------------------------------------------------------------------------
// Let's promote this person to customer.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.processPendingUnlink = function processPendingUnlink(entity, callback) {
  var dc = this.dataClient();
  var self = this;
  var redisKey = 'pendingunlinks';
  var upn = entity.aadupn;
  const fixedAuthScheme = 'aad';
  const oid = entity.aadoid;
  const id = entity.ghid;

  self.getGithubUsernameFromId(id, (getUsernameError, username) => {
    if (!username) {
      return callback(new Error(`No username found on GitHub from the ID ${id}.`));
    }
    var history = [];
    if (username !== entity.ghu) {
      history.push(`It looks like the GitHub user changed their username. The user ID ${id} today has the GitHub username of "${username}", but previously had the username ${entity.ghu}.`);
    }
    var orgsList = self.orgs();
    var orgs = [];
    async.each(orgsList, function (org, cb) {
      org.queryAnyUserMembership(username, function (err, membership) {
        if (membership && membership.state) {
          history.push(`"${username}" has the state "${membership.state}" in the "${org.name}" GitHub organization currently.`);
          orgs.push(org);
        }
        cb(null, membership);
      });
    }, function (queryingError) {
      if (queryingError) {
        return callback(queryingError);
      }
      // Remove from any orgs now
      if (orgs.length === 0) {
        history.push(`"${username}" has no active organization memberships in this environment.`);
      }
      async.each(orgs, function (org, cb) {
        history.push(`Dropping "${username}" from "${org.name}"...`);
        org.removeUserMembership(username, cb);
      }, function (error) {
        if (error) {
          // Keep the user in the list.
          history.push(`Error removing at least one org membership: ${error.message}`);
          return callback(error, history);
        }
        // Delete the link
        history.push('Removing any corporate link for ID ' + entity.ghid + ' username "' + username + '"');
        dc.removeLink(entity.ghid, function (error) {
          if (error) {
            history.push(`Link remove error (they may not have had a link): ${error.message}`);
            return callback(error, history);
          }
          // Delete any cached link for the user, then remove from the Redis set
          history.push('Removing any cached link from Redis for "' + upn + '"');
          invalidateCachedLink(self, fixedAuthScheme, oid, () => {
            history.push('Removing pending unlink entry from Redis for "' + upn + '"');
            self.redis.removeSetMember(redisKey, upn, function (err) {
              if (err) {
                history.push(`Remove pending unlink set member error with Redis: ${err.message}`);
                return callback(err, history);
              }
              callback(null, history);
            });
          });
        });
      });
    });
  });
};

// ----------------------------------------------------------------------------
// Retrieve a user's active organization memberships, aggressively cached.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getMyOrganizations = function (callback) {
  const self = this;
  const returnSetToInstances = (set) => {
    const orgs = [];
    self.orgs().forEach((org) => {
      if (set.has(org.name.toLowerCase())) {
        orgs.push(org);
      }
    });
    return callback(null, sortBy(orgs, 'name'));
  };
  const redisKey = 'user#' + self.id.github + ':orgs:active-memberships';
  self.redis.getObjectCompressed(redisKey, (error, orgsList) => {
    if (!error && orgsList) {
      return returnSetToInstances(new Set(orgsList));
    }
    self.getOrganizationsWithMembershipStates(true, (error, orgsList) => {
      if (error) {
        return callback(error);
      }
      const active = [];
      orgsList.forEach((org) => {
        if (org.membershipStateTemporary === 'active') {
          active.push(org.name.toLowerCase());
        }
      });
      self.redis.setObjectWithExpire(redisKey, active, 180 /* minutes */, function () {
        return returnSetToInstances(new Set(active));
      });
    });
  });
};

// ----------------------------------------------------------------------------
// Retrieve all organizations, including a property indicating the membership
// state of the user, if any.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getOrganizationsWithMembershipStates = function (allowCaching, callback) {
  const self = this;
  if (typeof allowCaching == 'function') {
    callback = allowCaching;
    allowCaching = true;
  }
  const orgs = [];
  async.each(self.orgs(), function (org, callback) {
    org.queryUserMembership(allowCaching, function (error, result) {
      let state = false;
      if (result && result.state) {
        state = result.state;
      }
      // Not sure how I feel about updating values on the org directly...
      org.membershipStateTemporary = state;
      orgs.push(org);
      callback(error);
    });
  }, function (/* ignoredError */) {
    callback(null, orgs);
  });
};

// ----------------------------------------------------------------------------
// Retrieve all of the teams -across all registered organizations. This is not
// specific to the user. This will include secret teams.
// Caching: the org.getTeams call has an internal cache at this time.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getAllOrganizationsTeams = function (callback) {
  const self = this;
  async.concat(self.orgs(), function (org, cb) {
    org.getTeams(cb);
  }, function (error, teams) {
    if (error) {
      return callback(error);
    }
    // CONSIDER: SORT: Do these results need to be sorted?
    callback(null, teams);
  });
};

// ----------------------------------------------------------------------------
// This function uses heavy use of caching since it is an expensive set of
// calls to make to the GitHub API when the cache misses: N API calls for N
// teams in M organizations.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getMyTeamMemberships = function (role, alternateUserId, callback) {
  const self = this;
  if (typeof alternateUserId == 'function') {
    callback = alternateUserId;
    alternateUserId = self.id.github;
  }
  this.getAllOrganizationsTeams(function (error, teams) {
    if (error) {
      return callback(error);
    }
    const myTeams = [];
    async.each(teams, function (team, callback) {
      team.getMembersCached(role, function (error, members) {
        if (error) {
          // If the team was deleted since the cache was created, this is not an error worth propagating.
          if (error.statusCode === 404) {
            return callback();
          }
          return callback(error);
        }
        for (let i = 0; i < members.length; i++) {
          const member = members[i];
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
// Designed for use by tooling, this returns the full set of administrators of
// teams across all orgs. Designed to help setup communication with the people
// using this portal for their daily engineering group work.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getAllMaintainers = function (callback) {
  this.getAllOrganizationsTeams(function (getTeamsError, teams) {
    if (getTeamsError) {
      return callback(getTeamsError);
    }
    const users = {};
    async.each(teams, function (team, callback) {
      team.getMembersCached('maintainer', function (getTeamMembersError, members) {
        if (getTeamMembersError) {
          return callback(getTeamMembersError);
        }
        for (let i = 0; i < members.length; i++) {
          const member = members[i];
          if (users[member.id] === undefined) {
            users[member.id] = member;
          }
          // A dirty patch on top, just to save time now.
          if (users[member.id]._getAllMaintainersTeams === undefined) {
            users[member.id]._getAllMaintainersTeams = {};
          }
          users[member.id]._getAllMaintainersTeams[team.id] = team;
        }
        callback();
      });
    }, function (getMembersIterationError) {
      if (getMembersIterationError) {
        return callback(getMembersIterationError);
      }
      const asList = [];
      for (const key in users) {
        const user = users[key];
        asList.push(user);
      }
      async.each(asList, function (user, cb) {
        user.getLink(cb);
      }, function (getUserLinkError) {
        callback(getUserLinkError, asList);
      });
    });
  });
};


// ----------------------------------------------------------------------------
// Retrieve a set of team results.
// ----------------------------------------------------------------------------
// [_] CONSIDER: Cache/ Consider caching this sort of important return result...
OpenSourceUserContext.prototype.getTeamSet = function (teamIds, inflate, callback) {
  const self = this;
  if (typeof inflate === 'function') {
    callback = inflate;
    inflate = false;
  }
  const teams = [];
  async.each(teamIds, function (teamId, cb) {
    self.getTeam(teamId, inflate, function (error, team) {
      if (!error) {
        teams.push(team);
      }
      cb(error);
    });
  }, function (error) {
    // CONSIDER: SORT: Do these results need to be sorted?
    callback(error, teams);
  });
};

// ----------------------------------------------------------------------------
// Retrieve a single team instance. This version hydrates the team's details
// and also sets the organization instance.
// ----------------------------------------------------------------------------
// [_] CONSIDER: Cache/ Consider caching this sort of important return result...
OpenSourceUserContext.prototype.getTeam = function (teamId, callback) {
  const self = this;
  const team = createBareTeam(self, teamId);
  team.getDetails(function (error) {
    if (error) {
      error = utils.wrapError(error, 'There was a problem retrieving the details for the team. The team may no longer exist.');
    }
    callback(error, error ? null : team);
  });
};

// ----------------------------------------------------------------------------
// Prepare a list of all organization names, lowercased, from the original
// config instance.
// ----------------------------------------------------------------------------
function allOrgNamesLowercase(orgs) {
  const list = [];
  if (orgs && orgs.length) {
    for (let i = 0; i < orgs.length; i++) {
      const name = orgs[i].name;
      if (!name) {
        throw new Error('No organization name has been provided for one of the configured organizations.');
      }
      list.push(name.toLowerCase());
    }
  }
  return list;
}

// ----------------------------------------------------------------------------
// Retrieve the "primary" organization by identifying which org, if any, has
// the grand portal sudoers team defined.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.primaryOrg = function getPrimaryOrg() {
  const orgs = this.orgs();
  let primaryOrg = null;
  orgs.forEach((org) => {
    const teamPortalSudoers = org.setting('teamPortalSudoers');
    if (teamPortalSudoers && primaryOrg === null) {
      primaryOrg = org;
    } else if (teamPortalSudoers) {
      const warning = 'Only one organization may contain a grand sudoers team. Please have an application administrator investigate this issue.';
      console.warn(warning);
    }
  });
  if (!primaryOrg && orgs.length === 1) {
    return orgs[0];
  }
  return primaryOrg;
};

// ----------------------------------------------------------------------------
// Retrieve an array of all organizations registered for management with this
// portal instance. Used for iterating through global operations. We'll need to
// use smart caching to land this experience better than in the past, and to
// preserve API use rates.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.orgs = function getAllOrgs() {
  const self = this;
  const allOrgNames = allOrgNamesLowercase(self.setting('github').organizations);
  const orgs = [];
  for (let i = 0; i < allOrgNames.length; i++) {
    orgs.push(self.org(allOrgNames[i]));
  }
  return orgs;
};

// ----------------------------------------------------------------------------
// Retrieve a user-scoped elevated organization object via a static
// configuration lookup.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.org = function getOrg(orgNameAnycase) {
  if (orgNameAnycase === undefined || orgNameAnycase === '') {
    console.warn('Using the first organization for tokens and other properties. This can cause problems when multiple tokens are in use.');
    orgNameAnycase = this.setting('github').organizations[0].name;
  }
  const name = orgNameAnycase.toLowerCase();
  if (this.cache.orgs[name]) {
    return this.cache.orgs[name];
  }
  let settings;
  const orgs = this.setting('github').organizations;
  for (let i = 0; i < orgs.length; i++) {
    if (orgs[i].name && orgs[i].name.toLowerCase() == name) {
      settings = orgs[i];
      break;
    }
  }
  if (!settings) {
    throw new Error('The requested organization "' + orgNameAnycase + '" is not currently available for actions or is not configured for use at this time.');
  }
  const tr = this.setting('corporate').trainingResources;
  if (tr && tr['onboarding-complete']) {
    const tro = tr['onboarding-complete'];
    const trainingResources = {
      corporate: tro.all,
      github: tro.github,
    };
    if (tro[name]) {
      trainingResources.organization = tro[name];
    }
    settings.trainingResources = trainingResources;
  }
  this.cache.orgs[name] = new Org(this, settings.name, settings);
  return this.cache.orgs[name];
};

// ----------------------------------------------------------------------------
// Retrieve an object representing the user, by GitHub ID.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.user = function getUser(id, optionalGitHubInstance) {
  const self = this;
  if (typeof id != 'string') {
    id = id.toString();
  }
  if (self.cache.users[id]) {
    return self.cache.users[id];
  } else {
    self.cache.users[id] = new User(self, id, optionalGitHubInstance);
    return self.cache.users[id];
  }
};

// ----------------------------------------------------------------------------
// Allows creating a team reference with just a team ID, no org instance.
// ----------------------------------------------------------------------------
function createBareTeam(oss, teamId) {
  const teamInstance = new Team(oss.org(), teamId, null);
  teamInstance.org = null;
  return teamInstance;
}

// ----------------------------------------------------------------------------
// Helper function for UI: Store in the user's session an alert message or
// action to be shown in another successful render. Contexts come from Twitter
// Bootstrap, i.e. 'success', 'info', 'warning', 'danger'.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.saveUserAlert = function (req, message, title, context, optionalLink, optionalCaption) {
  const alert = {
    message: message,
    title: title || 'FYI',
    context: context || 'success',
    optionalLink: optionalLink,
    optionalCaption: optionalCaption,
  };
  if (req.session) {
    if (req.session.alerts && req.session.alerts.length) {
      req.session.alerts.push(alert);
    } else {
      req.session.alerts = [
        alert,
      ];
    }
  }
};

// ----------------------------------------------------------------------------
// Helper function for UI: Render a view. By using our own rendering function,
// we can make sure that events such as alert views are still actually shown,
// even through redirect sequences.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.render = function (req, res, view, title, optionalObject) {
  if (typeof title == 'object') {
    optionalObject = title;
    title = '';
    debug('context::render: the provided title was actually an object');
  }
  const breadcrumbs = req.breadcrumbs;
  if (breadcrumbs && breadcrumbs.length && breadcrumbs.length > 0) {
    breadcrumbs[breadcrumbs.length - 1].isLast = true;
  }
  const authScheme = this.setting('authentication').scheme;
  const user = {
    primaryAuthenticationScheme: authScheme,
    primaryUsername: authScheme === 'github' ? this.usernames.github : this.usernames.azure,
    githubSignout: authScheme === 'github' ? '/signout' : '/signout/github',
    azureSignout: authScheme === 'github' ? '/signout/azure' : '/signout',
  };
  if (this.id.github || this.usernames.github) {
    user.github = {
      id: this.id.github,
      username: this.usernames.github,
      displayName: this.displayNames.github,
      avatarUrl: this.avatars.github,
      accessToken: this.tokens.github !== undefined,
      increasedScope: this.tokens.githubIncreasedScope !== undefined,
    };
  }
  if (this.usernames.azure) {
    user.azure = {
      username: this.usernames.azure,
      displayName: this.displayNames.azure,
    };
  }
  const reposContext = req.reposContext || {
    section: 'orgs',
    org: req.org,
  };
  const obj = {
    title: title,
    config: this.configuration,
    serviceBanner: this.setting('serviceMessage') ? this.setting('serviceMessage').banner : null,
    user: user,
    ossLink: this.entities.link,
    showBreadcrumbs: true,
    breadcrumbs: breadcrumbs,
    sudoMode: req.sudoMode,
    view: view,
    site: 'github',
    enableMultipleAccounts: req.session ? req.session.enableMultipleAccounts : false,
  };
  if (obj.ossLink && reposContext) {
    obj.reposContext = reposContext;
  }
  if (optionalObject) {
    Object.assign(obj, optionalObject);
  }
  if (req.session && req.session.alerts && req.session.alerts.length && req.session.alerts.length > 0) {
    const alerts = [];
    Object.assign(alerts, req.session.alerts);
    req.session.alerts = [];
    for (let i = 0; i < alerts.length; i++) {
      if (typeof alerts[i] == 'object') {
        alerts[i].number = i + 1;
      }
    }
    obj.alerts = alerts;
  }
  if (reposContext && !reposContext.availableOrganizations) {
    this.getMyOrganizations((getMyOrgsError, organizations) => {
      if (!getMyOrgsError && organizations && Array.isArray(organizations)) {
        reposContext.availableOrganizations = organizations;
        res.render(view, obj);
      }
    });
  } else {
    res.render(view, obj);
  }
};

// ----------------------------------------------------------------------------
// Cheap breadcrumbs on a request object as it goes through our routes. Does
// not actually store anything in the OSS instance at this time.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.addBreadcrumb = function (req, breadcrumbTitle, optionalBreadcrumbLink) {
  utils.addBreadcrumb(req, breadcrumbTitle, optionalBreadcrumbLink);
};

module.exports = OpenSourceUserContext;
