//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var async = require('async');
var utils = require('../../../utils');

var teamMaintainerRoute = require('./index-maintainer');

router.get('/join', function (req, res, next) {
    var team = req.team;
    async.waterfall([
        function (callback) {
            team.isMember(callback);
        },
        function (isMember, callback) {
            if (isMember === true) {
                return next(utils.wrapError(null, 'You are already a member of the team ' + team.name, true));
            }
            team.org.queryUserMembership(false, function (error, result) {
                if (error) {
                    result = false;
                }
                callback(null, result);
            });
        },
    ], function (error, isOrgMember) {
        if (error) {
            return next(error);
        }
        if (isOrgMember && isOrgMember.state && isOrgMember.state == 'active') {
            team.getOfficialMaintainers(function (error, maintainers) {
                if (error) {
                    return next(error);
                }
                req.oss.render(req, res, 'org/team/join', 'Join "' + team.name + '"', {
                    team: team,
                    teamMaintainers: maintainers,
                });
            });
        } else {
            var err = new Error('You are not an active member of the organization. Please onboard/join first.');
            err.skipLog = true;
            return next(err);
        }
    });
});

router.post('/join', function (req, res, next) {
    var oss = req.oss;
    var org = req.org;
    var team = req.team;
    var justification = req.body.justification;
    if (justification === undefined || justification === '') {
        return next(utils.wrapError(null, 'You must include justification for your request.', true));
    }
    var notificationsRepo = org.getWorkflowRepository();
    var dc = oss.dataClient();
    var assignTo = null;
    var requestId = null;
    var allMaintainers = null;
    var issueNumber = null;
    async.waterfall([
        function (callback) {
            team.isMember(callback);
        },
        function (isMember, callback) {
            if (isMember === true) {
                return next(utils.wrapError(null, 'You are already a member of the team ' + team.name, true));
            }
            team.getOfficialMaintainers(callback);
        },
        function (maintainers, callback) {
            var approvalRequest = {
                ghu: oss.usernames.github,
                ghid: oss.id.github,
                justification: req.body.justification,
                requested: ((new Date()).getTime()).toString(),
                active: false,
                type: 'joinTeam',
                org: team.org.name,
                teamid: team.id,
                teamname: team.name,
                email: oss.modernUser().contactEmail(),
                name: oss.modernUser().contactName(),
            };
            var randomMaintainer = maintainers[Math.floor(Math.random() * maintainers.length)];
            if (!randomMaintainer.login) {
                return next(new Error('For some reason the randomly picked maintainer is not setup in the portal properly. Please report this bug.'));
            }
            assignTo = randomMaintainer.login;
            var mnt = [];
            for (var i = 0; i < maintainers.length; i++) {
                if (maintainers[i].login) {
                    mnt.push('@' + maintainers[i].login);
                }
            }
            allMaintainers = mnt.join(', ');
            dc.insertApprovalRequest(team.id, approvalRequest, callback);
        },
        function (newRequestId) {
            requestId = newRequestId;
            var body = 'A team join request has been submitted by ' + oss.modernUser().contactName() + ' (' +
                        oss.modernUser().contactEmail() + ', [' + oss.usernames.github + '](' +
                        'https://github.com/' + oss.usernames.github + ')) to join your "' +
                        team.name + '" team ' + 'in the "' + team.org.name + '" organization.' + '\n\n' +
                        allMaintainers + ': Can a team maintainer [review this request now](' +
                        'https://' + req.hostname + '/approvals/' + requestId + ')?\n\n' + 
                        '<em>If you use this issue to comment with the team maintainers, please understand that your comment will be visible by all members of the organization.</em>';
            var callback = arguments[arguments.length - 1];
            notificationsRepo.createIssue({
                title: 'Request to join team "' + team.org.name + '/' + team.name + '" by ' + oss.usernames.github,
                body: body,
            }, callback);
        },
        function (issue) {
            req.oss.saveUserAlert(req, 'Your request to join ' + team.name + ' has been submitted and will be reviewed by a team maintainer.', 'Permission Request', 'success');
            var callback = arguments[arguments.length - 1];
            if (issue.id && issue.number) {
                issueNumber = issue.number;
                dc.updateApprovalRequest(requestId, {
                    issueid: issue.id.toString(),
                    issue: issue.number.toString(),
                    active: true
                }, callback);
            } else {
                callback(new Error('An issue could not be created. The response object representing the issue was malformed.'));
            }
        },
        function setAssignee () {
            var callback = arguments[arguments.length - 1];
            notificationsRepo.updateIssue(issueNumber, {
                assignee: assignTo,
            }, function (error) {
                if (error) {
                    // CONSIDER: Log. This error condition hits when a user has
                    // been added to the org outside of the portal. Since they
                    // are not associated with the workflow repo, they cannot
                    // be assigned by GitHub - which throws a validation error.
                    console.log('could not assign issue ' + issueNumber + ' to ' + assignTo);
                    console.dir(error);
                }
                callback();
            });
        }
    ], function (error) {
        if (error) {
            return next(error);
        }
        res.redirect(team.org.baseUrl + 'approvals/' + requestId);
    });
});

router.use(teamMaintainerRoute);

module.exports = router;
