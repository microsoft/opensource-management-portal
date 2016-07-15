//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var async = require('async');
var debug = require('debug')('azureossportal');
var utils = require('../utils');
var github = require('octonode');

var Org = require('./org');
var Team = require('./team');
var User = require('./user');
var Repo = require('./repo');
var RedisHelper = require('./redis');

function OpenSourceUserContext (applicationConfiguration, dataClient, user, redisInstance, callback) {
    var self = this;
    var modernUser;
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
    }
    this.setting = function (name) {
        return applicationConfiguration[name];
    };
    this.dataClient = function () {
        return dataClient;
    };
    this.redisClient = function () {
        return redisInstance;
    };
    this.requestUser = function () {
        return user;
    };
    this.safeConfigurationTemp = safeSettings(applicationConfiguration);
    this.authenticated = {
        github: user && user.github && user.github.id,
        azure: user && user.azure && user.azure.username,
    };
    this.entities = {
        link: null,
        primaryMembership: null,
    };
    this.usernames = {
        github: user && user.github && user.github.username ? user.github.username : undefined,
        azure: user && user.azure && user.azure.username ? user.azure.username : undefined,
    };
    this.id = {
        github: user && user.github && user.github.id ? user.github.id.toString() : undefined,
    };
    if (this.id.github) {
        this.createModernUser(this.id.github, this.usernames.github);
    }
    this.baseUrl = '/';
    this.redis = new RedisHelper(this, applicationConfiguration.redis.prefix);
    this.initializeBasics(function (initError) {
        if (callback) {
            return callback(initError, self);
        }
    });
}

// ----------------------------------------------------------------------------
// Populate the user's OSS context object.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.initializeBasics = function (callback) {
    var self = this;
    var requestUser = this.requestUser();
    if (!userObject && this.setting('primaryAuthenticationScheme') === 'aad' && requestUser.azure && requestUser.azure.username) {
        return this.dataClient().getUserByAadUpn(requestUser.azure.username, function (findError, userLinks) {
            if (findError) {
                // XXX: wrap with a useful message?
                return callback(findError);
            }
            if (userLinks.length === 0) {
                return callback();
            }
            if (userLinks.length > 1) {
                var tooManyLinksError = new Error(`This account has ${userLinks.length} linked GitHub accounts.`);
                tooManyLinksError.links = userLinks;
                tooManyLinksError.tooManyLinks = true;
                return callback(tooManyLinksError);
            }
            var link = userLinks[0];
            self.usernames.github = link.ghu;
            self.id.github = link.ghid.toString();
            self.createModernUser(self.id.github, self.usernames.github);
            self.entities.link = link;
            self.modernUser().link = link;
            // todo: if their AAD name or upn has changed, but oid is still the same... schedule an update!
            // question: should this.authenticated.github be true or false, since it isn't authenticated yet?
            callback(null, false);
        });
    }
    var userObject = this.modernUser();
    if (!userObject) {
        return callback(new Error("There's a logic bug in the user context object. We cannot continue."));
    }
    userObject.getLink(function (error, link) {
        if (error) {
            return callback(utils.wrapError(error, 'We were not able to retrieve information about any link for your user account at this time.'));
        }
        if (link) {
            self.entities.link = link;
        }
        callback(null, false);
        /*self.org().queryUserMembership(true, function (error, result) {
            // CONSIDER: This is part of the isAdministrator updates...
            if (result && result.state && result.role && result.role === 'admin') {
                self.entities.primaryMembership = result;
            }
            callback(null, false);
        });
        */
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
    /*
    var self = this;
    if (self.entities && self.entities.primaryMembership) {
        var pm = self.entities.primaryMembership;
        if (pm.role && pm.role === 'admin') {
            return callback(null, true);
        }
    }
    */
    this.org().getPortalSudoersTeam().isMember(function (error, isMember) {
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
    var ownerToken = this.org().setting('ownerToken');
    if (!ownerToken) {
        throw new Error('No "ownerToken" set for the ' + this.org().name + ' organization.');
    }
    return github.client(ownerToken);
};

// ----------------------------------------------------------------------------
// Make sure system links are loaded for a set of users.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getLinksForUsers = function (list, callback) {
    var dc = this.dataClient();
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
        var groups = [];
        var j = 0;
        var perGroup = 200;
        var group = [];
        for (var i = 0; i < map.length; i++) {
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
                        var oldError = error;
                        error = new Error('Storage returned an HTTP ' + oldError.headers.statusCode + '.');
                        console.error.log(oldError.headers.body);
                        error.innerError = oldError;
                    }
                    return cb(error);
                }
                // So inefficient and lazy:
                for (var i = 0; i < list.length; i++) {
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
    var self = this;
    for (var i = 0; i < list.length; i++) {
        var id = list[i];
        list[i] = self.user(id);
    }
    self.getLinksForUsers(list, callback);
};

// ----------------------------------------------------------------------------
// Translate a hash of IDs to usernames into developed objects, system links
// and details loaded. Hash key is username, ID is the initial hash value.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getCompleteUsersFromUsernameIdHash = function (hash, callback) {
    var self = this;
    var users = {};
    var list = [];
    for (var key in hash) {
        var id = hash[key];
        var username = key;
        var user = self.user(id);
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
                user.getDetailsByUsername(function (formerUserError) {
                    // Ignore the user with an error... this means they left GitHub.
                    if (formerUserError) {
                        console.dir(formerUserError);
                    }
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
// Retrieve all organizations that the user is a member of, if any.
// Caching: this set of calls can optionally turn off Redis caching, for use
// during onboarding.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getMyOrganizations = function (allowCaching, callback) {
    var self = this;
    if (typeof allowCaching == 'function') {
        callback = allowCaching;
        allowCaching = true;
    }
    var orgs = [];
    async.each(self.orgs(), function (org, callback) {
        org.queryUserMembership(allowCaching, function (error, result) {
            var state = false;
            if (result && result.state) {
                state = result.state;
            }
            // Not sure how I feel about updating values on the org directly...
            org.membershipStateTemporary = state;
            orgs.push(org);
            callback(error);
        });
    }, function (error) {
        callback(null, orgs);
    });
};

// ----------------------------------------------------------------------------
// Retrieve all of the teams -across all registered organizations. This is not
// specific to the user. This will include secret teams.
// Caching: the org.getTeams call has an internal cache at this time.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getAllOrganizationsTeams = function (callback) {
    var self = this;
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
    var self = this;
    if (typeof alternateUserId == 'function') {
        callback = alternateUserId;
        alternateUserId = self.id.github;
    }
    this.getAllOrganizationsTeams(function (error, teams) {
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
// Designed for use by tooling, this returns the full set of administrators of
// teams across all orgs. Designed to help setup communication with the people
// using this portal for their daily engineering group work.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.getAllMaintainers = function (callback) {
    this.getAllOrganizationsTeams(function (error, teams) {
        if (error) {
            return callback(error);
        }
        var users = {};
        async.each(teams, function (team, callback) {
            team.getMembersCached('maintainer', function (error, members) {
                if (error) {
                    return callback(error);
                }
                for (var i = 0; i < members.length; i++) {
                    var member = members[i];
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
        }, function (error) {
            var asList = [];
            for (var key in users) {
                var user = users[key];
                asList.push(user);
            }
            async.each(asList, function (user, cb) {
                user.getLink(cb);
            }, function (error) {
                callback(error, asList);
            });
        });
    });
};


// ----------------------------------------------------------------------------
// Retrieve a set of team results.
// ----------------------------------------------------------------------------
// [_] CONSIDER: Cache/ Consider caching this sort of important return result...
OpenSourceUserContext.prototype.getTeamSet = function (teamIds, inflate, callback) {
    var self = this;
    if (typeof inflate === 'function') {
        callback = inflate;
        inflate = false;
    }
    var teams = [];
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
    var self = this;
    var team = createBareTeam(self, teamId);
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
    var list = [];
    if (orgs && orgs.length) {
        for (var i = 0; i < orgs.length; i++) {
            var name = orgs[i].name;
            if (!name) {
                throw new Error('No organization name has been provided for one of the configured organizations.');
            }
            list.push(name.toLowerCase());
        }
    }
    return list;
}

// ----------------------------------------------------------------------------
// Retrieve an array of all organizations registered for management with this
// portal instance. Used for iterating through global operations. We'll need to
// use smart caching to land this experience better than in the past, and to
// preserve API use rates.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.orgs = function getAllOrgs() {
    var self = this;
    var allOrgNames = allOrgNamesLowercase(self.setting('organizations'));
    var orgs = [];
    for (var i = 0; i < allOrgNames.length; i++) {
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
        orgNameAnycase = this.setting('organizations')[0].name;
    }
    var name = orgNameAnycase.toLowerCase();
    if (this.cache.orgs[name]) {
        return this.cache.orgs[name];
    }
    var settings;
    var orgs = this.setting('organizations');
    for (var i = 0; i < orgs.length; i++) {
        if (orgs[i].name && orgs[i].name.toLowerCase() == name) {
            settings = orgs[i];
            break;
        }
    }
    if (!settings) {
        throw new Error('The requested organization "' + orgNameAnycase + '" is not currently available for actions or is not configured for use at this time.');
    }
    var tr = this.setting('corporate').trainingResources;
    if (tr && tr['onboarding-complete']) {
        var tro = tr['onboarding-complete'];
        var trainingResources = {
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
    var self = this;
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
    var teamInstance = new Team(oss.org(), teamId, null);
    teamInstance.org = null;
    return teamInstance;
}

// ----------------------------------------------------------------------------
// Helper function for UI: Store in the user's session an alert message or
// action to be shown in another successful render. Contexts come from Twitter
// Bootstrap, i.e. 'success', 'info', 'warning', 'danger'.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.saveUserAlert = function (req, message, title, context, optionalLink, optionalCaption) {
    var alert = {
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

function safeSettings(config) {
    // CONSIDER: IMPLEMENT.
    return config;
}

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
    var breadcrumbs = req.breadcrumbs;
    if (breadcrumbs && breadcrumbs.length && breadcrumbs.length > 0) {
        breadcrumbs[breadcrumbs.length - 1].isLast = true;
    }
    var obj = {
        title: title,
        config: this.safeConfigurationTemp,
        serviceBanner: this.setting('serviceBanner'),
        user: this.requestUser(),
        ossLink: this.entities.link,
        showBreadcrumbs: true,
        breadcrumbs: breadcrumbs,
        sudoMode: req.sudoMode,
    };
    if (optionalObject) {
        utils.merge(obj, optionalObject);
    }
    if (req.session && req.session.alerts && req.session.alerts.length && req.session.alerts.length > 0) {
        var alerts = [];
        utils.merge(alerts, req.session.alerts);
        req.session.alerts = [];
        for (var i = 0; i < alerts.length; i++) {
            if (typeof alerts[i] == 'object') {
                alerts[i].number = i + 1;
            }
        }
        obj.alerts = alerts;
    }
    res.render(view, obj);
};

// ----------------------------------------------------------------------------
// Cheap breadcrumbs on a request object as it goes through our routes. Does
// not actually store anything in the OSS instance at this time.
// ----------------------------------------------------------------------------
OpenSourceUserContext.prototype.addBreadcrumb = function (req, breadcrumbTitle, optionalBreadcrumbLink) {
    utils.addBreadcrumb(req, breadcrumbTitle, optionalBreadcrumbLink);
};

module.exports = OpenSourceUserContext;
