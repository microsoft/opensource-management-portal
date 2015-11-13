//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var async = require('async');
var github = require('octonode');
var debug = require('debug')('azureossportal');
var utils = require('../utils');
var OpenSourceRepo = require('./repo');

function OpenSourceOrganizationTeam (orgInstance, id, optionalInitialData) {
    if (!id) {
        throw new Error('No team ID was provided for construction.');
    }
    this.id = id;
    if (!orgInstance) {
        throw new Error('Required organization instance is missing.');
    }
    this.org = orgInstance;
    this.oss = orgInstance.oss;
    this.otherFields = {};
    this._detailsLoaded = false;
    if (optionalInitialData) {
        setDetails(this, optionalInitialData);
    }
}

// ----------------------------------------------------------------------------
// Properties of interest in the standard GitHub response for a team
// ----------------------------------------------------------------------------
var detailsToCopy = [
    'name',
    'slug',
    'description',
    'permission',
    'url',
    'members_url',
    'repositories_url',
    'members_count',
    'repos_count',
    'privacy',
];
var detailsToSkip = [
    'id',
    'organization',
];

// ----------------------------------------------------------------------------
// Creates a GitHub (octonode) API client for this team ID.
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.createGitHubTeamClient = function () {
    var source = this[this.org ? 'org' : 'oss'];
    var method = source.createGenericGitHubClient;
    if (method === undefined) {
        throw new Error('Unable to find the GitHub client factory associated with the team.');
    }
    var client = method.call(source);
    return client.team(this.id);
};

// ----------------------------------------------------------------------------
// Get the team details
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.getDetails = function queryTeamDetails(callback) {
    var self = this;
    self.createGitHubTeamClient().info(function (error, info) {
        if (error) {
            return callback(utils.wrapError(error, 'We were unable to retrieve information about team ID ' + self.id + '.'));
        }
        var copy = {};
        utils.merge(copy, info);
        if (!self.org && info.organization && info.organization.login) {
            self.org = self.oss.org(info.organization.login);
        }
        setDetails(self, info); // destructive operation
        callback(null, copy);
    });
};

// ----------------------------------------------------------------------------
// Set the team details
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.setDetails = function setDetailsExternal(details) {
    if (details.id == this.id) {
        setDetails(this, details);
    } else {
        throw new Error('The provided details object does not reference team ID ' + this.id);
    }
};

// ----------------------------------------------------------------------------
// Delete the team.
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.delete = function deleteTeam(callback) {
    this.createGitHubTeamClient().destroy(function (error) {
        if (error) {
            return callback(utils.wrapError(error, 'We were unable to delete team ID ' + self.id + ' using the GitHub API.'));
        }
        callback();
    });
};

// ----------------------------------------------------------------------------
// Update specific team details. Also updates the local copies in case the same
// request needs to show the updated info.
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.update = function updateTeamDetails(updates, callback) {
    var self = this;
    self.createGitHubTeamClient().update(updates, function (error, info) {
        if (error) {
            return callback(utils.wrapError(error, 'We were unable to update team ID ' + self.id + ' using the GitHub API.'));
        }
        var copy = {};
        utils.merge(copy, updates);
        setDetails(self, info); // destructive operation
        // Clear the org's cache in case the team was renamed...
        self.org.clearTeamsCache(callback);
    });
};

// ----------------------------------------------------------------------------
// Delete the team.
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.delete = function deleteTeam(callback) {
    var self = this;
    self.createGitHubTeamClient().destroy(function (error) {
        if (error) {
            return callback(utils.wrapError(error, 'We were unable to destroy the team ID ' + self.id + ' via the GitHub API.'));
        }
        self.org.clearTeamsCache(callback);
    });
};

// ----------------------------------------------------------------------------
// Ensure that we have team details.
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.ensureDetailsAndOrganization = function insurance(callback) {
    var self = this;
    var ensureOrganizationReference = function (cb) {
        if (!self.org) {
            if (self.otherFields.organization && self.otherFields.organization.login) {
                var orgName = self.otherFields.organization.login;
                self.org = self.oss.org(orgName);
            } else {
                return cb(new Error('The name of the organization for a team could not be retrieved logically.'));
            }
        }
        cb();
    };
    if (!self._detailsLoaded) {
        self.getDetails(function (error) {
            if (error) {
                return callback(error);
            }
            ensureOrganizationReference(callback);
        });
    } else {
        ensureOrganizationReference(callback);
    }
};

// ----------------------------------------------------------------------------
// Add a repo and permission level to a GitHub team.
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.addRepository = function addRepo(repoName, permission, callback) {
    this.org.createGenericGitHubClient().org(this.org.name).addTeamRepo(this.id, repoName, {
        permission: permission
    }, callback);
};

// ----------------------------------------------------------------------------
// Get the repos managed by the team.
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.getRepos = function queryRepos(callback) {
    var self = this;
    var ghteam = self.createGitHubTeamClient();
    // CONSIDER: GitHub API can let y ou filter for just org-owned repos now...
    utils.retrieveAllPages(ghteam.repos.bind(ghteam), function (error, repos) {
        if (error) {
            return callback(error);
        }
        async.filter(repos, function (repo, cb) {
            cb(repo && repo.owner && repo.owner.login && repo.owner.login.toLowerCase() == self.org.name.toLowerCase());
        }, function (repos) {
            async.map(repos, function (repo, cb) {
                cb(null, new OpenSourceRepo(self.org, repo.name, repo));
            }, callback);
        });
    });
};

// ----------------------------------------------------------------------------
// Check for public membership
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.isMember = function queryTeamMembership(callback) {
    var self = this;
    var username = self.oss.usernames.github;
    self.createGitHubTeamClient().membership(username, function (error, result) {
        return callback(null, result === true);
    });
};

// ----------------------------------------------------------------------------
// Add membership for the authenticated user OR another GitHub username
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.addMembership = function addTeamMembership(role, optionalUsername, callback) {
    var self = this;
    if (!(role == 'member' || role == 'maintainer')) {
        return callback(new Error('The provided role type "' + role + '" is not supported at this time.'));
    }
    if (typeof optionalUsername == 'function') {
        callback = optionalUsername;
        optionalUsername = self.oss.usernames.github;
    }
    var options = {
        role: role
    };
    self.createGitHubTeamClient().addMembership(optionalUsername, options, function (error, obj) {
        if (error) {
            callback(error);
        } else {
            clearRedisKeysAfterMembershipChange(self, function () {
                callback(null, obj);
            });
        }
    });
};

// ----------------------------------------------------------------------------
// Remove membership for the authenticated user OR another GitHub username
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.removeMembership = function removeTeamMembership(optionalUsername, callback) {
    var self = this;
    if (typeof optionalUsername == 'function') {
        callback = optionalUsername;
        optionalUsername = this.oss.usernames.github;
    }
    this.createGitHubTeamClient().removeMembership(optionalUsername, function (error) {
        if (!error) {
            clearRedisKeysAfterMembershipChange(self, callback);
        } else {
            callback(error);
        }
    });
};

function clearRedisKeysAfterMembershipChange(self, silentCallback) {
    var keys = [
        'team#' + self.id + '(all)',
        'team#' + self.id + '(member)',
        'team#' + self.id + '(maintainer)',
    ];
    async.each(keys, function (key, cb) {
        self.oss.redis.delete(key, cb);
    }, function () {
        if (silentCallback) {
            silentCallback();
        }
    });
}

// ----------------------------------------------------------------------------
// Retrieves the members of the team.
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.getMembers = function getMembers(optionalRole, callback) {
    var self = this;
    var params = null;
    if (typeof optionalRole == 'function') {
        callback = optionalRole;
        optionalRole = null;
    } else {
        params = {
            role: optionalRole
        };
    }
    var ghteam = this.createGitHubTeamClient();
    utils.retrieveAllPages(ghteam.members.bind(ghteam), params, function (error, members) {
        if (error) {
            return callback(error);
        }
        // Update the cache for this team
        var redisKey = 'team#' + self.id + '(' + optionalRole + ')';
        var randomExpireMinutes = utils.randomInteger(240, 60 * 24 * 2 /* 2 days max */);
        self.oss.redis.setObjectWithExpire(redisKey, members, randomExpireMinutes, function () {
            async.map(members, function (member, cb) {
                cb(null, self.oss.user(member.id, member));
            }, callback);
        });
    });
};

// ----------------------------------------------------------------------------
// Retrieves the members of the team. This is a fork of the getMembers method
// that does explicit Redis caching when available. For now, forked to avoid
// confusion.
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.getMembersCached = function getMembersCached(requiredRole, callback) {
    var self = this;
    if (typeof requiredRole == 'function') {
        return callback(new Error('getMembersCached requires a role.'));
    }
    var instancesFromJson = function (members) {
        async.map(members, function (member, cb) {
            cb(null, self.oss.user(member.id, member));
        }, callback);
    };
    var lightweightFieldsToPreserve = ['login', 'id'];
    var params = {
        role: requiredRole
    };
    var redisKey = 'team#' + self.id + '(' + requiredRole + ')';
    var ghteam = this.createGitHubTeamClient();
    self.oss.redis.getObject(redisKey, function (error, data) {
        if (!error && data) {
            return instancesFromJson(data);
        }
        utils.retrieveAllPages(ghteam.members.bind(ghteam), params, function (error, members) {
            if (error) {
                return callback(error);
            }
            async.map(members, function (member, cb) {
                var lw = {};
                for (var i = 0; i < lightweightFieldsToPreserve.length; i++) {
                    lw[lightweightFieldsToPreserve[i]] = member[lightweightFieldsToPreserve[i]];
                }
                cb(null, lw);
            }, function (error, lightweightMembers) {
                if (error) {
                    return callback(error);
                }
                var randomExpireMinutes = utils.randomInteger(240, 60 * 24 * 2 /* 2 days max */);
                self.oss.redis.setObjectWithExpire(redisKey, lightweightMembers, randomExpireMinutes, function () {
                    instancesFromJson(lightweightMembers);
                });
            });
        });
    });
};

// ----------------------------------------------------------------------------
// Retrieves the members of the team.
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.getMemberLinks = function getMembersAndLinks(callback) {
    var self = this;
    this.getMembers(function (error, members) {
        if (error) {
            return callback(error);
        }
        if (members.length && members.length > 0) {
            self.oss.getLinksForUsers(members, callback);
        } else {
            callback(null, []);
        }
    });
};

// ----------------------------------------------------------------------------
// Retrieves the maintainers of the team.
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.getMaintainers = function getMaintainers(callback) {
    this.getMembers('maintainer', callback);
};

// ----------------------------------------------------------------------------
// Retrieves the maintainers of the team, including fallback logic,
// in the case there are no explicit maintainers, we go to the organization's
// sudoers - a special team where any member of that specific team is granted
// special portal abilities. In the case that this organization does not have
// any sudoers defined, and this is a leaf node org, then the sudoers from the
// primary org will be appointed the official maintainers for this team. This
// function also loads the links from the underlying data system to be able to
// provide robust information about the users, including their corporate
// relationship.
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.getOfficialMaintainers = function (callback) {
    var self = this;
    self.ensureDetailsAndOrganization(function (error) {
        if (error) {
            return callback(error);
        }
        self.getMaintainers(function (error, maintainers) {
            if (error) {
                return callback(error);
            }
            if (maintainers.length > 0) {
                self.oss.getLinksForUsers(maintainers, callback);
            } else {
                // Better design here would be to then fallback to the org obj. to get members themselves.
                var team = self.org.getSudoersTeam();
                team.getMembers(function (error, members) {
                    if (!error && members && members.length === 0) {
                        error = new Error('No official organization approvers could be retrieved.');
                    }
                    if (error) {
                        return callback(error);
                    }
                    self.oss.getLinksForUsers(members, callback);
                });
            }
        });
    });
};

// ----------------------------------------------------------------------------
// Retrieves pending approvals for this specific team and hydrates user links
// and accounts. It is possible that errors could happen if a user were to
// rename their GitHub account after submitting a request since the request's
// copy of the login is used for link hydration.
// ----------------------------------------------------------------------------
OpenSourceOrganizationTeam.prototype.getApprovals = function (callback) {
    var self = this;
    var dc = this.oss.dataClient();
    dc.getPendingApprovals(this.id, function (error, pendingApprovals) {
        if (error) {
            return callback(utils.wrapError(error, 'We were unable to retrieve the pending approvals list for this team. There may be a data store problem.'));
        }
        var requestingUsers = {};
        async.each(pendingApprovals, function (approval, cb) {
            requestingUsers[approval.ghu] = approval.ghid;
            if (approval.requested) {
                var asInt = parseInt(approval.requested, 10);
                approval.requestedTime = new Date(asInt);
            }
            cb();
        }, function () {
            self.oss.getCompleteUsersFromUsernameIdHash(requestingUsers, function (error, users) {
                if (error) {
                    return callback(error);
                }
                async.each(pendingApprovals, function (approval, cb) {
                    var login = approval.ghu;
                    if (users[login]) {
                        approval.completeRequestingUser = users[login];
                    }
                    cb();
                }, function (error) {
                    callback(error, pendingApprovals);
                });
            });
        });
    });
};

// PRIVATE FUNCTIONS

function setDetails(team, details) {
    var self = team;
    var key = null;
    for (var i = 0; i < detailsToCopy.length; i++) {
        key = detailsToCopy[i];
        self[key] = utils.stealValue(details, key);
    }
    for (i = 0; i < detailsToSkip.length; i++) {
        key = detailsToSkip[i];
        self.otherFields[key] = utils.stealValue(details, key);
    }
    for (var k in details) {
        debug('Team details import, remaining key: ' + k);
    }
    self._detailsLoaded = true;
}

module.exports = OpenSourceOrganizationTeam;
