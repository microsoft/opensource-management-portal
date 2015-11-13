//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();
var async = require('async');
var github = require('octonode');
var utils = require('../utils');

router.get('/', function (req, res, next) {
    var dc = req.app.settings.dataclient;
    var oss = req.oss;
    oss.addBreadcrumb(req, 'Requests');
    async.parallel({
        ownedTeams: function (callback) {
            oss.getMyTeamMemberships('maintainer', function (err, ownedTeams) {
                if (err) {
                    return callback(err);
                }
                if (ownedTeams && ownedTeams.length && ownedTeams.length > 0) {
                    dc.getPendingApprovals(ownedTeams, function (error, appvs) {
                        if (error) {
                            return callback(error);
                        }
                        async.each(appvs, function (approval, cb) {
                            var teamFromRequest = approval.teamid;
                            if (teamFromRequest) {
                                oss.getTeam(teamFromRequest, function (err, teamInstance) {
                                    approval._teamInstance = teamInstance;
                                    cb(err);
                                });
                            } else {
                                cb();
                            }
                        }, function (err) {
                            callback(null, appvs);
                        });
                    });
                } else {
                    callback();
                }
            });
        },
        requestsUserMade: function (callback) {
            // CONSIDER: Need to hydrate with _teamInstance just like above...
            dc.getPendingApprovalsForUserId(req.user.github.id, callback);
        }
    }, function (error, results) {
        if (error) {
            return next(error);
        }
        async.each(results.requestsUserMade, function (request, cb) {
            var teamFromRequest = request.teamid;
            if (teamFromRequest) {
                oss.getTeam(teamFromRequest, function (err, teamInstance) {
                    request._teamInstance = teamInstance;
                    cb(err);
                });
            } else {
                cb();
            }
        }, function (error) {
            if (error) {
                return next(error);
            }
            oss.render(req, res, 'org/approvals', 'Review My Approvals', {
                teamResponsibilities: results.ownedTeams,
                usersRequests: results.requestsUserMade
            });
        });
    });
});

router.post('/:requestid/cancel', function (req, res, next) {
    var oss = req.oss;
    var dc = req.app.settings.dataclient;
    var requestid = req.params.requestid;
    dc.getApprovalRequest(requestid, function (error, pendingRequest) {
        if (error) {
            return next(new Error('The pending request you are looking for does not seem to exist.'));
        }
        if (pendingRequest.ghid == req.user.github.id) {
            dc.updateApprovalRequest(requestid, {
                active: false,
                decision: 'canceled-by-user',
                decisionTime: (new Date().getTime()).toString()
            }, function (error) {
                if (error) {
                    return next(error);
                }
                oss.getTeam(pendingRequest.teamid, function (error, team) {
                    if (error) {
                        return next(utils.wrapError(error, 'We could not get an instance of the team.'));
                    }
                    var workflowRepo = team.org.getWorkflowRepository();
                    var trackingIssue = workflowRepo.issue(pendingRequest.issue);
                    trackingIssue.createComment('This request was canceled by ' + req.user.github.username + ' via the open source portal and can be ignored.', function (ignoredError) {
                        // We ignore any error from the comment field, since that isn't the important part...
                        trackingIssue.close(function (error) {
                            if (error) {
                                return next(utils.wrapError(error, 'We had trouble closing the issue. Please take a look or report this as a bug.'));
                            }
                            res.redirect('/approvals/');
                        });
                    });
                });
            });
        } else {
            return next(new Error('You are not authorized to cancel this request.'));
        }
    });
});

router.get('/:requestid', function (req, res, next) {
    var oss = req.oss;
    var requestid = req.params.requestid;
    var dc = oss.dataClient();
    oss.addBreadcrumb(req, 'Your Request');
    var isMaintainer = false, pendingRequest = null, team = null, maintainers = null;
    async.waterfall([
        function (callback) {
            dc.getApprovalRequest(requestid, callback);
        },
        function (pendingRequestValue) {
            var callback = arguments[arguments.length - 1];
            pendingRequest = pendingRequestValue;
            oss.getTeam(pendingRequest.teamid, callback);
        },
        function (teamValue, callback) {
            team = teamValue;
            team.org.isUserSudoer(callback);
        },
        function (isOrgSudoer, callback) {
            isMaintainer = isOrgSudoer;
            team.getOfficialMaintainers(callback);
        },
        function (maintainersValue, callback) {
            maintainers = maintainersValue;
            if (!isMaintainer) {
                for (var i = 0; i < maintainers.length; i++) {
                    if (maintainers[i].id == oss.id.github) {
                        isMaintainer = true;
                    }
                }
            }
            if (isMaintainer) {
                var err = new Error('Redirecting to the admin experience to approve');
                var slugPreferred = team.slug || team.name;
                err.redirect = '/' + team.org.name + '/teams/' + slugPreferred + '/approvals/' + requestid;
                return callback(err);
            }
            if (pendingRequest.ghid != oss.id.github) {
                var msg = new Error('This request does not exist or was created by another user.');
                msg.skipLog = true;
                return callback(msg);
            }
            callback();
        }
    ], function (error) {
        if (error) {
            if (error.redirect) {
                return res.redirect(error.redirect);
            }
            // Edge case: the team no longer exists.
            if (error.innerError && error.innerError.innerError && error.innerError.innerError.statusCode == 404) {
                var dc = req.app.settings.dataclient;
                return closeOldRequest(dc, oss, pendingRequest, req, res, next);
            }
            return next(error);
        } else {
            if (pendingRequest.decisionTime) {
                var asInt = parseInt(pendingRequest.decisionTime, 10);
                pendingRequest.decisionTime = new Date(asInt);
            }
            oss.render(req, res, 'org/userApprovalStatus', 'Review your request', {
                entry: pendingRequest,
                team: team,
            });
        }
    });
});

function closeOldRequest(dc, oss, pendingRequest, req, res, next) {
    var org = oss.org(pendingRequest.org);
    var notificationRepo = org.getWorkflowRepository();
    if (pendingRequest.active === false) {
        oss.saveUserAlert(req, 'The team this request was for no longer exists.', 'Team gone!', 'success');
        return res.redirect('/');
    }
    var issue = notificationRepo.issue(pendingRequest.issue);
    issue.createComment('The team no longer exists on GitHub. This issue is being canceled.', function (error) {
        if (error) {
            next(error);
        }
        dc.updateApprovalRequest(pendingRequest.RowKey, {
            active: false,
            decisionNote: 'Team no longer exists.',
        }, function (error) {
            if (error) {
                next(error);
            }
            issue.close(function () {
                oss.saveUserAlert(req, 'The team this request was for no longer exists. The request has been canceled.', 'Team gone!', 'success');
                res.redirect('/');
            });
        });
    });
}

module.exports = router;
