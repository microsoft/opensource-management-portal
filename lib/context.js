//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

'use strict';

const async = require('async');
const debug = require('debug')('azureossportal');
const utils = require('../utils');
const insights = require('./insights');
const RedisHelper = require('./redis');

/*eslint no-console: ["error", { allow: ["warn"] }] */

function OpenSourceUserContext(options, callback) {
  const self = this;
  if (!options.operations) {
    return callback(new Error('operations object instance is required'));
  }
  self.operations = options.operations;
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
  this.operations = options.operations;
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
    modernUser = {
      link: null,
      login: login,
      id: id,
    };
    modernUser.contactEmail = function () {
      const muLink = modernUser.link;
      return muLink ? muLink.aadupn : null;
    };
    modernUser.contactName = function () {
      const muLink = modernUser.link;
      return muLink ? muLink.aadname : null;
    };
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

OpenSourceUserContext.prototype.invalidateLinkCache = function (oid, callback) {
  if (!callback && typeof(oid) === 'function') {
    callback = oid;
    oid = null;
  }
  if (!oid) {
    const modernUser = this.modernUser();
    if (modernUser && modernUser.link) {
      oid = modernUser.link.aadoid;
    }
  }
  if (!oid || typeof(oid) === 'function') {
    return callback(new Error('No AAD ID is available for the user to invalidate the cache.'));
  }
  invalidateCachedLink(this, 'aad', oid, callback);
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
  const expectedAuthProviderName = 'aad';
  const expectedAuthProperty = 'azure';
  const expectedSecondaryAuthProperty = 'oid';
  const dataClientAuthLookupMethod = 'getUserByAadOid';
  let authPropertiesPresent = requestUser[expectedAuthProperty] && requestUser[expectedAuthProperty][expectedSecondaryAuthProperty];
  if (!authPropertiesPresent) {
    return callback(new Error('Authentication problem, missing properties or system error'));
  }
  const userAuthLookupValue = requestUser[expectedAuthProperty][expectedSecondaryAuthProperty];
  const getUserCacheStartTime = Date.now();
  return tryGetCachedLink(self, expectedAuthProviderName, userAuthLookupValue, (getCachedLinkError, cachedLink) => {
    const getUserCacheEndTime = Date.now();
    if (self.insights) {
      self.insights.trackDependency('UserLinkCache', dataClientAuthLookupMethod, getUserCacheEndTime - getUserCacheStartTime, !getCachedLinkError);
    }
    if (getCachedLinkError) {
      return callback(getCachedLinkError);
    }
    const selectedId = request.session && request.session.selectedGithubId ? request.session.selectedGithubId : undefined;
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
    const dc = self.dataClient();
    const authLookupMethod = dc[dataClientAuthLookupMethod];
    authLookupMethod.call(dc, userAuthLookupValue, (findError, userLinks) => {
      const getUserEndTime = Date.now();
      if (self.insights) {
        self.insights.trackDependency('UserLinkLookup', dataClientAuthLookupMethod, getUserEndTime - getUserStartTime, !findError);
      }
      if (findError) {
        const wrappedError = utils.wrapError(findError, 'There was a problem trying to load the link data');
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
        tryCacheLink(self, expectedAuthProviderName, userAuthLookupValue, selectedLink, selectedId !== undefined, callback);
      });
    });
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
  const operations = this.operations;
  const username = this.usernames.github;
  /*
  var self = this;
  if (self.entities && self.entities.primaryMembership) {
      var pm = self.entities.primaryMembership;
      if (pm.role && pm.role === 'admin') {
          return callback(null, true);
      }
  }
  */
  const primaryName = operations.getOrganizationOriginalNames()[0];
  const primaryOrganization = operations.getOrganization(primaryName);
  const sudoTeam = primaryOrganization.systemSudoersTeam;
  if (!sudoTeam) {
    return callback(null, false);
  }
  sudoTeam.isMember(username, (error, isMember) => {
    if (error) {
      return callback(utils.wrapError(error, 'We had trouble querying GitHub for important team management information. Please try again later or report this issue.'));
    }
    return callback(null, isMember === true || isMember === 'member');
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
// Let's promote this person to customer.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.processPendingUnlink = function processPendingUnlink(entity, options, callback) {
  const self = this;
  if (!callback && typeof(options) === 'function') {
    callback = options;
    options = null;
  }
  options = options || {};
  const operations = self.operations;

  const redisKey = 'pendingunlinks';
  const fixedAuthScheme = 'aad';

  const oid = entity.aadoid;
  const id = entity.ghid;
  const upn = entity.aadupn;
  const account = operations.getAccount(id);
  const reason = options.reason || 'Automated processPendingUnlink operation';

  account.terminate({ reason: reason }, (error, history) => {
    // this used to be a feature to help in ops:
    // if (username !== entity.ghu) {
    //   history.push(`It looks like the GitHub user changed their username. The user ID ${id} today has the GitHub username of "${username}", but previously had the username ${entity.ghu}.`);
    // }

    // Delete any cached link for the user, then remove from the Redis set
    history.push(`Removing any cached link from Redis for ${upn}`);
    invalidateCachedLink(self, fixedAuthScheme, oid, () => {
      history.push(`Removing pending unlink entry from Redis for ${upn}`);
      self.redis.removeSetMember(redisKey, upn, function (err) {
        if (err) {
          history.push(`Remove pending unlink set member error with Redis: ${err.message}`);
          return callback(err, history);
        }
        callback(null, history);
      });
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
    organization: req.organization,
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
  return res.render(view, obj);
  // TODO: RESTORE A GOOD CALL HERE!
/*
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
  */
};

// ----------------------------------------------------------------------------
// Cheap breadcrumbs on a request object as it goes through our routes. Does
// not actually store anything in the OSS instance at this time.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.addBreadcrumb = function (req, breadcrumbTitle, optionalBreadcrumbLink) {
  utils.addBreadcrumb(req, breadcrumbTitle, optionalBreadcrumbLink);
};

module.exports = OpenSourceUserContext;
