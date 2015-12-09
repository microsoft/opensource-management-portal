//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var async = require('async');
var utils = require('../utils');
var github = require('octonode');

// ----------------------------------------------------------------------------
// Onboarding helper
// ----------------------------------------------------------------------------
// This file is only used when an organization has its "onboarding" value set.
// It helps present a dev or devops person with the mapping of team IDs to team
// names for the organization. This is not actually a middleware route but
// rather a configuration/app initialization method just stored here to keep it
// out of the way.
// ----------------------------------------------------------------------------
module.exports = function (app, config) {
    async.each(config.onboarding, function (org, callback) {
        if (org && org.name && org.ownerToken) {
            var s = 'Organization Onboarding Helper for "' + org.name + '":\n';
            for (var key in org) {
                s += '- ' + key + ': ';
                s += (org[key] !== undefined) ? 'value set' : 'undefined';
                s += '\n';
            }
            var ghc = github.client(org.ownerToken);
            var ghorg = ghc.org(org.name);
            utils.retrieveAllPages(ghorg.teams.bind(ghorg), function (error, teamInstances) {
                if (!error && teamInstances && teamInstances.length) {
                    s += 'Here is a mapping from team ID to team slug (based on the name),\nto help with selecting the team IDs needed to run the portal\nsuch as the repo approvers and sudoers teams.\n\n';
                    for (var j = 0; j < teamInstances.length; j++) {
                        var team = teamInstances[j];
                        s += team.id + ': ' + team.slug + '\n';
                    }
                    console.log(s);
                } else if (error) {
                    console.dir(error);
                    console.log(s);
                }
            });
        } else {
            console.log('An org requires that its NAME and TOKEN configuration parameters are set before onboarding can begin.');
        }
    }, function () {
        console.log('This concludes the execution of the onboarding helper.');
    });
};
