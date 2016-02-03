//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var async = require('async');
var github = require('octonode');
var utils = require('../utils');
var debug = require('debug')('azureossportal');

function OpenSourceUser (ossInstance, githubId, optionalGitHubInstance) {
    this.id = githubId;
    this.oss = ossInstance;
    this.otherFields = {};
    this.link = null;
    this._detailsLoaded = false;
    if (optionalGitHubInstance) {
        setDetails(this, optionalGitHubInstance);
    }
}

// ----------------------------------------------------------------------------
// Properties of interest in the standard GitHub response for a user
// ----------------------------------------------------------------------------
var detailsToCopy = [
    'login',
    'avatar_url',
    // only in detailed info responses:
    'name',
    'company',
    'location',
    'email',
    'bio',
    'created_at',
    'updated_at',
];
var detailsToSkip = [
    'id',
    'gravatar_id',
    'url',
    'html_url',
    'followers_url',
    'following_url',
    'gists_url',
    'starred_url',
    'subscriptions_url',
    'organizations_url',
    'repos_url',
    'events_url',
    'received_events_url',
    'hooks_url',
    'issues_url',
    'type',
    'site_admin',
    // only in detailed info responses:
    'blog',
    'hireable',
    'public_repos',
    'public_gists',
    'followers',
    'following',
    // organizations:
    'members_url',
    'public_members_url',
    'description',
    'total_private_repos',
    'owned_private_repos',
    'private_gists',
    'disk_usage',
    'collaborators',
    'billing_email',
    'plan',
    // when in the context of a collaborators response only:
    'permissions',
];

// ----------------------------------------------------------------------------
// Retrieve the link contact information, if the link has been loaded.
// ----------------------------------------------------------------------------
OpenSourceUser.prototype.contactEmail = function () {
    return this.link ? this.link.aadupn : null;
};

// ----------------------------------------------------------------------------
// Retrieve the link contact information alias subset, if link loaded.
// ----------------------------------------------------------------------------
OpenSourceUser.prototype.corporateAlias = function () {
    if (this.link && this.link.aadupn) {
        var email = this.link.aadupn;
        var i = email.indexOf('@');
        if (i >= 0) {
            return email.substring(0, i);
        }
    }
    return null;
};

// ----------------------------------------------------------------------------
// Retrieve the link contact information alias subset, if link loaded.
// ----------------------------------------------------------------------------
OpenSourceUser.prototype.corporateProfileUrl = function () {
    var alias = this.corporateAlias();
    var prefix = this.oss.setting('corporate').userProfilePrefix;
    if (alias && prefix) {
        return prefix + alias;
    }
    return null;
};

// ----------------------------------------------------------------------------
// Retrieve the link contact information, if the link has been loaded.
// ----------------------------------------------------------------------------
OpenSourceUser.prototype.contactName = function () {
    if (this.link) {
        return this.link.aadname || this.login;
    }
    return this.login;
};

// ----------------------------------------------------------------------------
// Retrieves the URL for the user's avatar, if present. If the user's details
// have not been loaded, we will not yet have an avatar URL.
// ----------------------------------------------------------------------------
OpenSourceUser.prototype.avatar = function (optionalSize) {
    if (!optionalSize) {
        optionalSize = 80;
    }
    if (this.avatar_url) {
        return this.avatar_url + '&s=' + optionalSize;
    } else {
        return undefined;
    }
};

// ----------------------------------------------------------------------------
// Retrieve the link, if any, for this user from the underlying datastore. Will
// cache the value in memory for this instance, since the lifetime of these
// objects is a single request.
// ----------------------------------------------------------------------------
OpenSourceUser.prototype.getLink = function (callback) {
    if (this.link) {
        return callback(null, this.link);
    }
    var self = this;
    var dc = self.oss.dataClient();
    dc.getLink(self.id, function (error, link) {
        if (error) {
            return callback(utils.wrapError(error, 'We were not able to retrieve information about the link for user ' + self.id + ' at this time.'));
        }
        self.link = (link === false) ? false : dc.reduceEntity(link);
        callback(null, self.link);
    });
};

OpenSourceUser.prototype.getLinkRequired = function (callback) {
    var self = this;
    this.getLink(function (error) {
        if (!error && self.link === false) {
            error = new Error('No link retrieved.');
        }
        if (error) {
            return callback(error);
        }
        callback(null, self.link);
    });
};

// ----------------------------------------------------------------------------
// Special-use function to set the link when provided elsewhere. This is
// helpful since we can efficiently query a large set of links for team list
// scenarios and then set them here.
// ----------------------------------------------------------------------------
OpenSourceUser.prototype.setLinkInstance = function (links, optionalSuppressDebug) {
    if (!Array.isArray(links)) {
        links = [links];
    }
    for (var i = 0; i < links.length; i++) {
        var link = links[i];
        if (link.ghid === this.id) {
            this.link = link;
            break;
        }
    }
    if (!this.link && optionalSuppressDebug !== true) {
        throw new Error('No matching link was provided for the user ID ' + this.id + '.');
    }
};

// ----------------------------------------------------------------------------
// Special-use function to set the link when provided elsewhere. This is
// helpful since we can efficiently query a large set of links for team list
// scenarios and then set them here. Captures a throw and ignores the issue.
// ----------------------------------------------------------------------------
OpenSourceUser.prototype.trySetLinkInstance = function (links, optionalSuppressDebug) {
    try {
        this.setLinkInstance(links, optionalSuppressDebug);
    } catch (error) {
        debug('trySetLinkInstance: No link exists for user ' + this.id);
    }
};

// ----------------------------------------------------------------------------
// Load the GitHub details for the user.
// Problem: we have the ID, but GitHub cheaply prefers usernames, not IDs...
// ----------------------------------------------------------------------------
OpenSourceUser.prototype.getDetailsByUsername = function (login, callback) {
    var self = this;
    var username = this.login;
    if (typeof login == 'function') {
        callback = login;
        login = null;
    } else {
        username = login;
    }
    if (!username) {
        return callback(new Error('No username provided for retrieving the details of user ' + self.id));
    }
    self.oss.createGenericGitHubClient().user(username).info(function (error, info) {
        if (error) {
            return callback(utils.wrapError(error, 'We were unable to retrieve information about user ' + username + ' (' + self.id + ').'));
        }
        var copy = {};
        utils.merge(copy, info);
        setDetails(self, info); // destructive operation
        callback(null, copy);
    });
};

OpenSourceUser.prototype.getProfileCreatedDate = function () {
    if (this.created_at) {
        return new Date(this.created_at);
    }
    return null;
};

OpenSourceUser.prototype.getProfileUpdatedDate = function () {
    if (this.updated_at) {
        return new Date(this.updated_at);
    }
    return null;
};

OpenSourceUser.prototype.debugView = function () {
    var obj = {};
    for (var key in this) {
        var val = this[key];
        if (typeof val == 'string') {
            obj[key] = val;
        } else {
            if (key == 'otherFields' || key == 'link' || key == 'bio') {
                obj[key] = val;
            }
        }
    }
    return obj;
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
        debug('User details import, remaining key: ' + k);
    }
    self._detailsLoaded = true;
}

module.exports = OpenSourceUser;
