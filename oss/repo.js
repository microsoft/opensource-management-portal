//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var async = require('async');
var github = require('octonode');
var debug = require('debug')('azureossportal');
var utils = require('../utils');
var Issue = require('./issue');

function OpenSourceRepo (orgInstance, repoName, optionalGitHubInstance) {
    if (!orgInstance) {
        throw new Error('orgInstance is not defined.');
    }
    this.org = orgInstance;
    this.oss = this.org.oss;
    var i = repoName.indexOf('/');
    if (i >= 0) {
        this.full_name = repoName;
        var orgName = repoName.substring(0, i);
        repoName = repoName.substring(i + 1);
        if (orgName.toLowerCase() !== orgInstance.name.toLowerCase()) {
            debug('WARNING: The org name does not match: (' + orgName + ', ' + orgInstance.name + ')');
        }
    } else {
        this.full_name = orgInstance.name + '/' + repoName;
    }
    this.name = repoName;
    this.inner = {
        issues: {}
    };
    this.otherFields = {};
    this._detailsLoaded = false;
    if (optionalGitHubInstance) {
        setDetails(this, optionalGitHubInstance);
    }
}

// ----------------------------------------------------------------------------
// Properties of interest in the standard GitHub response for a user
// ----------------------------------------------------------------------------
var detailsToCopy = [
    'id',
    'name',
    'full_name',
    'private',
    'html_url',
    'description',
    'fork',
    'url',
    'created_at',
    'updated_at',
    'pushed_at',
    'git_url',
    'ssh_url',
    'clone_url',
    'homepage',
    'size',
    'stargazers_count',
    'watchers_count',
    'language',
    'has_issues',
    'has_downloads',
    'has_wiki',
    'has_pages',
    'forks_count',
    'open_issues_count',
    'forks',
    'open_issues',
    'watchers',
    'default_branch',
    'permissions',
];
var detailsToSkip = [
    'owner',
    'forks_url',
    'keys_url',
    'collaborators_url',
    'teams_url',
    'hooks_url',
    'issue_events_url',
    'events_url',
    'assignees_url',
    'branches_url',
    'tags_url',
    'blobs_url',
    'git_tags_url',
    'git_refs_url',
    'trees_url',
    'statuses_url',
    'languages_url',
    'stargazers_url',
    'contributors_url',
    'subscribers_url',
    'subscription_url',
    'commits_url',
    'git_commits_url',
    'comments_url',
    'issue_comment_url',
    'contents_url',
    'compare_url',
    'merges_url',
    'archive_url',
    'downloads_url',
    'issues_url',
    'pulls_url',
    'milestones_url',
    'notifications_url',
    'labels_url',
    'releases_url',
    'svn_url',
    'mirror_url',
    'organization',
    'network_count',
    'subscribers_count',
    'deployments_url',
];

// ----------------------------------------------------------------------------
// Creates a GitHub API client for this repo.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.createGitHubRepoClient = function () {
    var client = this.org.createGenericGitHubClient();
    debug('creating repo client for ' + this.org.name + '/' + this.name);
    return client.repo(this.org.name + '/' + this.name);
};

// ----------------------------------------------------------------------------
// Retrieve the details for the repo.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.getDetails = function (callback) {
    var client = this.createGitHubRepoClient();
    var self = this;
    client.info(function (error, details) {
        if (error) {
            console.dir(error);
            return callback(utils.wrapError(error, 'Could not get details about the repo. It may not exist.'));
        }
        setDetails(self, details);
        callback(null, details);
    });
};

// ----------------------------------------------------------------------------
// Get contribution statistics for the repo.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.contributorsStatsOneTime = function (callback) {
    this.createGitHubRepoClient().contributorsStats(function (error, stats) {
        if (error) {
            var er = utils.wrapError(error, '');
            if (error && error.status && error.status == 202) {
                er.status = 202;
            }
            return callback(er);
        }
        callback(null, stats);
    });
};

// ----------------------------------------------------------------------------
// Add a collaborator with a specified permission level.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.addCollaborator = function (githubUsername, permissionLevel, callback) {
    if (typeof permissionLevel == 'function') {
        callback = permissionLevel;
        permissionLevel = 'pull';
    }
    this.createGitHubRepoClient().addCollaborator(githubUsername, {
        permission: permissionLevel,
    }, function(error, info) {
        if (error) {
            var message = error.statusCode == 404 ? 'The GitHub username "' + githubUsername + '" does not exist.' : 'The collaborator could not be added to GitHub at this time. There may be a problem with the GitHub API.';
            error.skipLog = error.statusCode == 404;
            return callback(utils.wrapError(error, message));
        }
        callback();
    });
};

// ----------------------------------------------------------------------------
// Remove a collaborator.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.removeCollaborator = function (githubUsername, callback) {
    var self = this;
    this.createGitHubRepoClient().removeCollaborator(githubUsername, function(error) {
        if (error) {
            return callback(utils.wrapError(error, 'The collaborator could not be removed at this time. Was "' + githubUsername + '" even a collaborator for ' + self.name + '?'));
        }
        callback();
    });
};

// ----------------------------------------------------------------------------
// Retrieve the list of teams that maintain this repo.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.teams = function getRepoTeamList(allowRedis, callback) {
    var self = this;
    if (typeof allowRedis == 'function') {
        callback = allowRedis;
        allowRedis = true;
    }
    var instancesFromJson = function (teamInstances) {
        async.map(teamInstances, function (teamInstance, cb) {
            cb(null, self.org.team(teamInstance.id, teamInstance));
        }, callback);
    };
    var redisKey = 'org#' + self.org.name + '/repo#' + self.name + ':teams';
    self.oss.redis.getObject(redisKey, function (error, data) {
        if (!error && data && allowRedis === true) {
            return instancesFromJson(data);
        }
        var ghrepo = self.createGitHubRepoClient();
        ghrepo.teams(function (error, teamInstances) {
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
// Get the list of collaborators for the repo from GitHub.
// ----------------------------------------------------------------------------
// CONSIDER: Use the Redis cache for this super hacky call.
OpenSourceRepo.prototype.getOutsideCollaborators = function (callback) {
    var self = this;
    var client = this.createGitHubRepoClient();
    this.org.getAdministratorsHashCached(function (error, adminUsernamesToIds) {
        var administratorIds = {};
        for (var admin in adminUsernamesToIds) {
            administratorIds[adminUsernamesToIds[admin]] = true;
        }
        self.org.getAllMembersById(function (error, membersHash) {
            if (error) {
                return callback(utils.wrapError(error, 'While looking up collaborators, we were not able to retrieve organization membership information.'));
            }
            utils.retrieveAllPages(client.collaborators.bind(client), function (error, collaborators) {
                if (error) {
                    return callback(utils.wrapError(error, 'We ran into a problem while trying to retrieve the collaborators for this repo.'));
                }
                async.map(collaborators, function (data, cb) {
                    var rcp = data.permissions;
                    delete data.permissions;
                    var user = self.oss.user(data.id, data);
                    user._repoCollaboratorPermissions = rcp;
                    cb(null, user);
                }, function (error, collaboratorObjects) {
                    // This is a workaround as suggested by GitHub.
                    var corporateUsersToRemove = {};
                    var corporateUsersWithCollaborationRights = [];
                    async.each(collaboratorObjects, function (co, cb) {
                        if (administratorIds[co.id]) {
                            // Organization admin
                            corporateUsersToRemove[co.id] = true;
                            return cb();
                        }
                        if (membersHash[co.id]) {
                            corporateUsersToRemove[co.id] = true;
                            if (co._repoCollaboratorPermissions && co._repoCollaboratorPermissions.admin === true) {
                                // This is a corporate user who has collaborator rights for this one.
                                // We will still resolve the link.
                                corporateUsersWithCollaborationRights.push(co);
                                return co.getLink(function (ignored, link) {
                                    cb();
                                });
                            }
                        }
                        cb();
                    }, function (error) {
                        if (error) {
                            return callback(error);
                        }
                        async.reject(collaboratorObjects, function (co, cb) {
                            cb(corporateUsersToRemove[co.id] === true);
                        }, function (results) {
                            async.sortBy(results, function (entry, cb) {
                                cb(null, entry.login);
                            }, function (error, sorted) {
                                callback(error, sorted, corporateUsersWithCollaborationRights);
                            });
                        });
                    });
                });
            });
        });
    });
};

// ----------------------------------------------------------------------------
// Update the repo properties with a patch.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.update = function updateRepo(patch, callback) {
    // CONSIDER: Wrap errors.
    this.createGitHubRepoClient().update(patch, callback);
};

// ----------------------------------------------------------------------------
// Delete the repo from GitHub.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.delete = function updateRepo(patch, callback) {
    // CONSIDER: Wrap errors.
    this.createGitHubRepoClient().destroy(callback);
};

// ----------------------------------------------------------------------------
// Retrieve a repo-scoped issue object.
// ----------------------------------------------------------------------------
OpenSourceRepo.prototype.issue = function getIssueInstance(issueNumber, optionalInitialData) {
    var self = this;
    if (typeof issueNumber != 'string') {
        issueNumber = issueNumber.toString();
    }
    if (self.inner.issues[issueNumber]) {
        return self.inner.issues[issueNumber];
    } else {
        self.inner.issues[issueNumber] = new Issue(self, issueNumber, optionalInitialData);
        return self.inner.issues[issueNumber];
    }
};

// CONSIDER: OLD: Is this needed still?
OpenSourceRepo.prototype.createIssue = function (issue, callback) {
    var fullName = this.full_name;
    var repositoryClient = this.oss.createGenericGitHubClient().repo(fullName);
    repositoryClient.createIssue(issue, function (error, createdIssue) {
        if (error) {
            error = utils.wrapError(error, 'We had trouble opening an issue to track this request in the ' + fullName + ' repo.');
        }
        callback(error, createdIssue);
    });
};

// CONSIDER: OLD: Is this needed still?
OpenSourceRepo.prototype.updateIssue = function (issueNumber, patch, callback) {
    var fullName = this.full_name;
    var issueClient = this.oss.createGenericGitHubClient().issue(this.full_name, issueNumber);
    issueClient.update(patch, function (error, updatedIssue) {
        if (error) {
            error = utils.wrapError(error, 'We had trouble updated the issue in the ' + fullName + ' repo.');
        }
        callback(error, updatedIssue);
    });
};

function setDetails(self, details) {
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
        debug('Repo details import, remaining key: ' + k);
    }
    self._detailsLoaded = true;
}

module.exports = OpenSourceRepo;
