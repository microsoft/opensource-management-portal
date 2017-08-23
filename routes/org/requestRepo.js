//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

//-----------------------------------------------------------------------------
//
// This file is no longer used in production
//
//-----------------------------------------------------------------------------

//-----------------------------------------------------------------------------
//
// WARNING:
//
// This file is a nightmare. The repo creation process has been modernized
// and this is a remnant of the earlier implementation that was modified a
// few too many different ways.
//
// With the latest refactoring to remove the 'legacy' parallel source code
// for many GitHub operations, this code will _no longer work_ without
// a little more effort.
//
//-----------------------------------------------------------------------------

const async = require('async');
const utils = require('../../utils');
const emailRender = require('../../lib/emailRender');
const RepoWorkflowEngine = require('./RepoWorkflowEngine.js');
const express = require('express');
const router = express.Router();

//-----------------------------------------------------------------------------
//
// August 2017
//
// THIS ROUTE AND FUNCTION DOES NOT WORK
// THIS ROUTE AND FUNCTION DOES NOT WORK
// THIS ROUTE AND FUNCTION DOES NOT WORK
//
// The code has been refactored. A lot.
//
//-----------------------------------------------------------------------------

router.use(function (req, res, next) {
  req.legacyUserContext.addBreadcrumb(req, 'Request a new repo');
  next();
});

function waterfallCallback() {
  var args = Array.prototype.slice.call(arguments);
  var callback = args.pop();
  args.unshift(null);
  callback.apply(undefined, args);
}

router.post('/', function (req, res, next) {
  const organization = req.organization;
  const operations = req.app.settings.providers.operations;
  let displayHostname = req.hostname;
  const config = req.app.settings.runtimeConfig;
  if (organization.createRepositoriesOnGitHub) {
    const directUrl = `https://github.com/organizations/${organization.name}/repositories/new`;
    const directError = utils.wrapError(null, 'This organization does not allow repository requests through this portal. Please use GitHub.com directly.', true);
    directError.fancyLink = {
      title: 'Create a repo on GitHub.com',
      link: directUrl,
    };
    return next(directError);
  }
  let orgHasCla = false;
  try {
    const claTeams = org.getLegacyClaTeams(true);
    orgHasCla = req.body.claEntity && claTeams[req.body.claEntity];
  } catch (noClaError) { /* ignored */ }
  if (!req.body.name || (req.body.name.length !== undefined && req.body.name.length === 0)) {
    return next(utils.wrapError(null, 'Please provide a repo name.', true));
  }
  if (orgHasCla && req.body.claEntity && (!req.body.claMail || (req.body.claMail.length !== undefined && req.body.claMail.length === 0))) {
    return next(utils.wrapError(null, 'Please provide an e-mail address to receive CLA notifications.', true));
  }
  if (req.body.name.indexOf(' ') >= 0) {
    return next(utils.wrapError(null, 'Repos cannot have spaces in their name. Consider a dash.', true));
  }
  if (req.body.name.includes('/')) {
    return next(utils.wrapError(null, 'Repos cannot have slashes in their name.', true));
  }
  if (org.inner.settings.approvalTypes || config.github.approvalTypes.fields.approvalTypes) {
    var approvalType = req.body.approvalType;
    if ((org.inner.settings.exemptionDetailsRequired || config.github.approvalTypes.fields.exemptionDetailsRequired || []).indexOf(approvalType) >= 0) {
      if (!req.body.justification || (req.body.justification.length !== undefined && req.body.justification.length === 0)) {
        return next(utils.wrapError(null, 'Exemption details are required.', true));
      }
    }
  }
  var userMailAddress = null;
  const repoApprovalTypesValues = config.github.approvalTypes.repo;
  if (repoApprovalTypesValues.length === 0) {
    return next(new Error('No repo approval providers configured.'));
  }
  const repoApprovalTypes = new Set(repoApprovalTypesValues);
  const mailProviderInUse = repoApprovalTypes.has('mail');
  var issueProviderInUse = repoApprovalTypes.has('github');
  if (!mailProviderInUse && !issueProviderInUse) {
    return next(new Error('No configured approval providers configured.'));
  }

  const approverMailAddresses = [];
  const mailProvider = req.app.settings.mailProvider;
  if (mailProviderInUse && !mailProvider) {
    return next(utils.wrapError(null, 'No mail provider is enabled, yet this application is configured to use a mail provider.'));
  }
  const mailAddressProvider = req.app.settings.mailAddressProvider;

  // Match the desired repo visibility to that which is supported in this organization.
  // If no type is given, default to the best choice for the current organization.
  var typeMap = { public: ['public'], private: ['private'], publicprivate: ['private', 'public'] };
  var allowedTypes = typeMap[organization.configuredOrganizationRepositoryTypes.toLowerCase()];
  if (!allowedTypes)
    return next(new Error('Service not configured with allowed repo types'));
  var repoType = req.body.visibility || allowedTypes[0];
  if (allowedTypes.indexOf(repoType.toLowerCase()) === -1)
    return next(new Error('This org does not support creation of ' + repoType + ' repos'));
  req.body.visibility = repoType;

  if (!req.body.teamCount) {
    return next(new Error('Invalid.'));
  }
  var teamsRequested = [];
  var teamCount = Math.floor(req.body.teamCount);
  var foundAdminTeam = false;
  var i = 0;
  for (i = 0; i < teamCount + 1; i++) {
    var existingTeamId = req.body['existingTeam' + i];
    if (existingTeamId && existingTeamId > 0) {
      existingTeamId = Math.floor(existingTeamId);
      var perm = req.body['existingTeamPermission' + i];
      if (existingTeamId > 0 && perm == 'pull' || perm == 'push' || perm == 'admin') {
        var tr = {
          id: existingTeamId,
          permission: perm,
        };
        teamsRequested.push(tr);
        if (perm == 'admin') {
          foundAdminTeam = true;
        }
      }
    }
  }
  if (!foundAdminTeam) {
    return next(utils.wrapError(null, 'You must select an admin team so that the repo can be written to and managed.', true));
  }
  const dc = req.app.settings.dataclient;
  const team2 = organization.repositoryApproversTeam;
  let template = 'other';
  if (req.body.license && req.body.license.toLowerCase() === 'mit') {
    template = 'mit';
  }
  const legacyUserContext = req.legacyUserContext;
  const username = legacyUserContext.usernames.github;
  const id = legacyUserContext.id.github;
  const contextEmailIfAny = legacyUserContext.modernUser().contactEmail();
  let approvalRequest = {
    ghu: username,
    ghid: id,
    justification: req.body.justification,
    requested: ((new Date()).getTime()).toString(),
    active: false,
    teamid: team == null ? -1 : team.id,
    type: 'repo',
    org: organization.name.toLowerCase(),
    repoName: req.body.name,
    repoDescription: req.body.description,
    repoUrl: req.body.url,
    repoVisibility: req.body.visibility,
    email: contextEmailIfAny,
    license: req.body.license,
    approvalType: req.body.approvalType,
    approvalUrl: req.body.approvalUrl,
    gitignore_template: req.body.language,
    template: template,
  };
  if (orgHasCla && req.body.claEntity) {
    approvalRequest.claMail = req.body.claMail;
    approvalRequest.claEntity = req.body.claEntity;
  }
  approvalRequest.teamsCount = teamsRequested.length;
  for (i = 0; i < teamsRequested.length; i++) {
    approvalRequest['teamid' + i] = teamsRequested[i].id;
    approvalRequest['teamid' + i + 'p'] = teamsRequested[i].permission;
  }
  var workflowRepository = null;
  try {
    workflowRepository = issueProviderInUse ? organization.legacyNotificationsRepository : null;
  } catch (noWorkflowRepoError) {
    issueProviderInUse = false;
  }
  var repoWorkflow = null;
  var createdNewRepoDetails = null;
  var isApprovalRequired = team != null;
  var generatedRequestId = null;
  var repoCreateResults = null;
  const approvalScheme = displayHostname === 'localhost' && config.webServer.allowHttp === true ? 'http' : 'https';
  const reposSiteBaseUrl = `${approvalScheme}://${displayHostname}/`;
  const approvalBaseUrl = `${reposSiteBaseUrl}approvals/`;
  async.waterfall([

    // Validate that this repo is new
    (callback) => {
      const existingRepo = org.repo(approvalRequest.repoName);
      existingRepo.getDetails((getDetailsError) => {
        if (getDetailsError) {
          return callback();
        }
        const existsError = utils.wrapError(getDetailsError, `The repo "${approvalRequest.repoName}" already exists.`, true);
        existsError.detailed = 'If you cannot see it on GitHub, the repo is currently private and an active repo administrator would be able to help you get access.';
        return callback(existsError);
      });
    },

    // get the user's e-mail address
    function (callback) {
      const upn = contextEmailIfAny;
      mailAddressProvider.getAddressFromUpn(upn, (resolveError, mailAddress) => {
        if (resolveError) {
          return callback(resolveError);
        }
        userMailAddress = mailAddress;
        callback();
      });
    },

    //Step 1 - get approval team members.
    function (callback) {
      if (isApprovalRequired === true) {
        team.getMemberLinks(function (error, maintainers) {
          if (error) {
            callback(new Error('It seems that the repo approvers information is unknown, or something happened when trying to query information about the team you are trying to apply to. Please file a bug or try again later. Sorry!'), null);
            return;
          }
          if (maintainers === undefined || maintainers.length === undefined || maintainers.length === 0) {
            callback(new Error('It seems that the repo approvers for this team is unknown. Please file a bug. Thanks.'), null);
            return;
          }
          var randomMaintainer = maintainers[Math.floor(Math.random() * maintainers.length)];
          if (!randomMaintainer.link || !randomMaintainer.link.ghu) {
            req.insights.trackEvent('RandomMaintainerFailure', randomMaintainer);
          }
          var assignTo = randomMaintainer && randomMaintainer.link && randomMaintainer.link.ghu ? randomMaintainer.link.ghu : '';
          var allMaintainers = [];
          async.each(maintainers, (maintainer, next) => {
            const approverUpn = maintainer && maintainer.link && maintainer.link.aadupn ? maintainer.link.aadupn : null;
            if (maintainer.link.ghu && approverUpn) {
              allMaintainers.push('@' + maintainer.link.ghu);
              mailAddressProvider.getAddressFromUpn(approverUpn, (getAddressError, mailAddress) => {
                if (getAddressError) {
                  return next(getAddressError);
                }
                approverMailAddresses.push(mailAddress);
                next();
              });
            } else {
              next();
            }
          }, (addressResolutionError) => {
            if (addressResolutionError) {
              return callback(addressResolutionError);
            }
            if (allMaintainers.length === 0) {
              return callback(new Error('No linked team maintainers are available to approve this request. Please report this issue, a maintainer may be needed for this team.'));
            }
            var consolidatedMaintainers = allMaintainers.join(', ');
            callback(null, {
              consolidatedMaintainers: consolidatedMaintainers,
              assignTo: assignTo
            });
          });
        });
      } else {
        callback(null, { consolidatedMaintainers: '', assignTo: '' });
      }
    },

    //Step 2 - Store the request in azure table.
    function (args, callback) {
      dc.insertGeneralApprovalRequest('repo', approvalRequest, function (error, requestId) {
        if (error) {
          callback(error, null);
          return;
        }
        generatedRequestId = requestId;
        args.requestId = requestId;
        callback(null, args);
      });
    },

    //Step 3 - Create an issue in notification repository.
    issueProviderInUse === false ? waterfallCallback : function (args, callback) {
      var body = 'Hi,\n' + username + ' has requested a new repo for the ' + organization.name + ' ' +
        'organization.' + '\n\n' +
        args.consolidatedMaintainers + ': Can a repo approver for this org review the request now at ' + '\n' +
        'https://' + displayHostname + '/approvals/' + args.requestId + '?\n\n' +
        '<small>Note: This issue was generated by the open source portal.</small>' + '\n\n' +
        '<small>If you use this issue to comment with the team maintainers(s), please understand that your comment will be visible by all members of the organization.</small>';

      workflowRepository.createIssue({
        title: 'Request to create a repo - ' + username,
        body: body,
      }, function (error, issue) {
        if (error) {
          callback(utils.wrapError(error, 'A tracking issue could not be created to monitor this request. Please contact the admins and provide this URL to them. Thanks.'));
          return;
        }
        if (isApprovalRequired == true) {
          req.legacyUserContext.saveUserAlert(req, 'Your repo request has been submitted and will be reviewed by one of the repo approvers for the org for naming consistency, business justification, etc. Thanks!', 'Repo Request Submitted', 'success');
        }
        args.issue = issue;
        callback(null, args);
      });
    },

    //Step 4 - Add issue id and number to request kept in db.
    issueProviderInUse === false ? waterfallCallback : function (args, callback) {
      if (args.issue.id && args.issue.number) {
        dc.updateApprovalRequest(args.requestId, {
          issueid: args.issue.id.toString(),
          issue: args.issue.number.toString(),
          active: true
        }, function (/* error is ignored - not sure why just linting now */) {
          callback(null, args);
        });
      }
      else {
        callback(null, args);
      }
    },

    //Step 5 - Assign an issue to approver.
    issueProviderInUse === false ? waterfallCallback : function (args, callback) {
      workflowRepository.updateIssue(args.issue.number, {
        assignee: args.assignTo,
      }, function (gitError) {
        if (gitError) {
          callback(gitError);

        } else {
          // CONSIDER: Log gitError. Since assignment fails for users
          // who have not used the portal, it should not actually
          // block the workflow from assignment.
          callback(null, args);
        }
      });
    },

    //Step 7 - Create a Repo if approval is not required
    function (args, callback) {
      if (isApprovalRequired == true) {
        return callback(null, args);
      }
      getRequestApprovalPkg(args.requestId, legacyUserContext, dc, operations, function (err, approvalPackage) {
        if (err) {
          return callback(utils.wrapError(err,
            'A request authorization package could not be created at this time.'));
        }
        args.approvalPackage = approvalPackage;
        repoWorkflow = new RepoWorkflowEngine(null, organization, approvalPackage);
        repoWorkflow.performApprovalOperation(function (err, newRepoDetails) {
          if (err) {
            err.detailed = 'Repo creation request is submitted but there was an error creating a repo.';
            err.skipLog = true;
            return callback(err);
          }
          createdNewRepoDetails = newRepoDetails;
          callback(null, args);
        });
      });
    },

    //Step 8 - Add teams to the repo as a next step for repo. creation.
    function (args, callback) {
      if (isApprovalRequired == true) {
        callback(null, args);
        return;
      }
      repoWorkflow.generateSecondaryTasks(function (err, tasks) {
        if (err) {
          callback(err);
          return;
        }
        if (tasks) {
          async.series(tasks, function (err, output) {
            if (err) {
              callback(err);
            } else {
              repoCreateResults = output;
              callback(null, args);
            }
          });
        }
        else {
          callback(null, args);
        }
      });
    },

    //Step 9 - Add Comment to the created issue and close the issue.
    issueProviderInUse === false ? waterfallCallback : function (args, callback) {
      if (isApprovalRequired == true) {
        callback(null, args);
        return;
      }
      var commentBody = repoWorkflow.messageForAction('approve');
      commentBody += '\n\n<small>This was generated by the Open Source Portal on behalf of ' +
        args.assignTo + '.</small>';
      args.issueCloseComment = commentBody;
      var issue = workflowRepository.issue(args.issue.number);
      issue.createComment(commentBody, function (errIssueComment) {
        if (errIssueComment) {
          return callback('Repo is created but there was an error putting comment to an issue - ' + args.issue.number);
        }
        issue.close(function (errIssueClose) {
          if (errIssueClose) {
            return callback('Repo is created but there was an error closing an issue - ' + args.issue.number);
          }
          callback(null, args);
        });
      });
    },

    isApprovalRequired === false || mailProviderInUse === false ? waterfallCallback : function sendMailToApprovers(args, callback) {
      // If approval is required, let's ask for approval now
      const approversAsString = approverMailAddresses.join(', ');
      const mail = {
        to: approverMailAddresses,
        subject: `New ${approvalRequest.org} repo ${approvalRequest.repoName} by ${userMailAddress}`,
        reason: (`You are receiving this e-mail because you are a repo approver for this organization.
                  To stop receiving these mails, you can leave the repo approvals team on GitHub.
                  This mail was sent to: ${approversAsString}`),
        headline: `New ${approvalRequest.org} repo requested`,
        classification: 'action',
        service: 'Microsoft GitHub',
        correlationId: req.correlationId,
      };
      const contentOptions = {
        correlationId: req.correlationId,
        approvalRequest: approvalRequest,
        version: config.logging.version,
        actionUrl: approvalBaseUrl + generatedRequestId,
        reposSiteUrl: reposSiteBaseUrl,
      };
      emailRender.render(req.app.settings.basedir, 'repoApprovals/pleaseApprove', contentOptions, (renderError, mailContent) => {
        if (renderError) {
          req.insights.trackException(renderError, {
            content: contentOptions,
            eventName: 'ReposRequestPleaseApproveMailRenderFailure',
          });
          return callback(renderError);
        }
        mail.content = mailContent;
        mailProvider.sendMail(mail, (mailError, mailResult) => {
          const customData = {
            content: contentOptions,
            receipt: mailResult,
          };
          if (mailError) {
            customData.eventName = 'ReposRequestPleaseApproveMailFailure';
            req.insights.trackException(mailError, customData);
            return callback(mailError);
          }
          req.insights.trackEvent('ReposRequestPleaseApproveMailSuccess', customData);
          dc.updateApprovalRequest(generatedRequestId, {
            active: true,
            mailSentToApprovers: approversAsString,
            mailSentTo: userMailAddress,
          }, function (activateError) {
            callback(activateError, args);
          });
        });
      });
    },

    mailProviderInUse === false ? waterfallCallback : function sendEmail(args, callback) {
      // Let's send e-mail to the requester about this action
      const headline = isApprovalRequired ? 'Repo request submitted' : 'Repo ready';
      const subject = isApprovalRequired ? `Your new repo request for "${approvalRequest.repoName}"` : `Your repo "${approvalRequest.repoName}" has been created`;
      const emailTemplate = isApprovalRequired ? 'repoApprovals/requestSubmitted' : 'repoApprovals/autoCreated';
      const mail = {
        to: userMailAddress,
        subject: subject,
        reason: (`You are receiving this e-mail because you requested the creation of a repo.
                  This mail was sent to: ${userMailAddress}`),
        headline: headline,
        classification: 'information',
        service: 'Microsoft GitHub',
        correlationId: req.correlationId,
      };
      const contentOptions = {
        correlationId: req.correlationId,
        approvalRequest: approvalRequest,
        results: repoCreateResults,
        version: config.logging.version,
        reposSiteUrl: reposSiteBaseUrl,
      };
      emailRender.render(req.app.settings.basedir, emailTemplate, contentOptions, (renderError, mailContent) => {
        if (renderError) {
          req.insights.trackException(renderError, {
            content: contentOptions,
            eventName: 'ReposRequestSubmittedMailRenderFailure',
          });
          return callback(renderError);
        }
        mail.content = mailContent;
        mailProvider.sendMail(mail, (mailError, mailResult) => {
          const customData = {
            content: contentOptions,
            receipt: mailResult,
          };
          if (mailError) {
            customData.eventName = 'ReposRequestSubmittedMailFailure';
            req.insights.trackException(mailError, customData);
            return callback(mailError);
          }
          req.insights.trackEvent('ReposRequestSubmittedMailSuccess', customData);
          callback(null, args);
        });
      });
    },

    //Step 10 - Update approval request record in the table.
    function (args, callback) {
      if (isApprovalRequired == true) {
        return callback(null, args);
      }
      var requestUpdates = {
        decision: 'approve',
        active: false,
        repoId: createdNewRepoDetails.id,
        decisionTime: (new Date().getTime()).toString(),
        decisionBy: username,
        decisionNote: args.issueCloseComment,
        decisionEmail: contextEmailIfAny,
      };
      dc.updateApprovalRequest(args.requestId, requestUpdates, function (err) {
        if (err) {
          return callback('Repo is created but there was an error closing the request.');
        }
        callback(null, args);
      });
    }
  ],

    function (err) {
      if (err) {
        return next(err);
      }
      else {
        if (isApprovalRequired == true) {
          req.legacyUserContext.render(req, res, 'message', 'Repo request submitted', {
            messageTitle: req.body.name.toUpperCase() + ' REPO',
            message: 'Your request has been submitted for review to the approvers group for the requested organization.'
          });
        } else {
          if (createdNewRepoDetails && createdNewRepoDetails.name) {
            req.legacyUserContext.saveUserAlert(req, `Your repo "${createdNewRepoDetails.name}" has been created.`, 'New GitHub repository created', 'success');
          }
          req.legacyUserContext.render(req, res, 'message', 'Repo request approved', {
            messageTitle: req.body.name.toUpperCase() + ' REPO',
            message: 'Your request has been completed and the repo created.',
            messageLink: createdNewRepoDetails.html_url,
            messageLinkTitle: `Open ${createdNewRepoDetails.full_name} on GitHub`,
            messageLinkTarget: 'new',
          });
        }
      }
    });

});

router.get('/', function (req, res, next) {
  const languages = req.app.settings.runtimeConfig.github.gitignore.languages;
  const config = req.app.settings.runtimeConfig;
  var orgName = org.name.toLowerCase();
  const operations = req.app.settings.providers.operations;
  const organization = operations.getOrganization(orgName);
  const createMetadata = organization.getRepositoryCreateMetadata();
  var highlightedTeams = organization.inner.settings.highlightedTeams;
  var allowPrivateRepos = organization.configuredOrganizationRepositoryTypes == 'publicprivate' || organization.configuredOrganizationRepositoryTypes == 'private';
  var allowPublicRepos = organization.configuredOrganizationRepositoryTypes == 'publicprivate' || organization.configuredOrganizationRepositoryTypes == 'public';
  if (organization.createRepositoriesOnGitHub) {
    return req.legacyUserContext.render(req, res, 'org/requestRepo', 'Request a a new repository on GitHub.com', {
      orgName: orgName,
      orgConfig: org.inner.settings,
      org: org,
    });
  }
  var claTeams = null;
  var orgHasCla = organization.isLegacyClaAutomationAvailable();
  try {
    claTeams = organization.getLegacyClaTeams(true);
  } catch (noClaError) { /* ignored */ }
  organization.getTeams(false /* do not use cached */, function (error, teams) {
    if (error) {
      return next(utils.wrapError(error, 'Could not read the entire list of read (pull) teams from GitHub. Please try again later or report this error if you continue seeing it.'));
    }
    const team2 = organization.repositoryApproversTeam;
    getApproverMembers(team, function (error, approvers) {
      if (error) {
        return next(new Error('Could not retrieve the repo approvers for ' + orgName));
      }
      var featuredTeamsCount = 0;
      var selectTeams = [];
      var i = 1;
      selectTeams.push({
        number: i++,
        adminOnly: true,
      });
      if (highlightedTeams !== undefined && highlightedTeams && highlightedTeams.length) {
        featuredTeamsCount = highlightedTeams.length;
        for (; i < featuredTeamsCount + 1; i++) {
          var ht = highlightedTeams[i - 1];
          ht.number = i;
          ht.name = org.team(ht.id).name;
          selectTeams.push(ht);
        }
      }
      const allMembersTeam = organization.invitationTeam;
      ++featuredTeamsCount;
      selectTeams.push({
        number: i++,
        name: allMembersTeam.name,
        id: allMembersTeam.id,
        readOnly: true,
        info: 'This team contains all members of the "' + org.name + '" GitHub org who have onboarded and linked. Highly recommended for ease of read access.',
      });
      for (; i < featuredTeamsCount + 4; i++) {
        selectTeams.push({
          number: i
        });
      }

      var approvalTypes = null;
      if (org.inner.settings.approvalTypes || config.github.approvalTypes.fields && config.github.approvalTypes.fields.approvalTypes) {
        approvalTypes = new Array();

        var typesConfig = org.inner.settings.approvalTypes || config.github.approvalTypes.fields.approvalTypes;
        var urlRequiredConfig = org.inner.settings.approvalUrlRequired || config.github.approvalTypes.fields.approvalUrlRequired ||  [];
        var format = org.inner.settings.approvalUrlFormat || config.github.approvalTypes.fields.approvalUrlFormat;
        var exemptionDetailsConfig = org.inner.settings.exemptionDetailsRequired || config.github.approvalTypes.fields.exemptionDetailsRequired || [];

        for (var ctr = 0; ctr < typesConfig.length; ctr++) {
          approvalTypes.push({
            value: typesConfig[ctr],
            urlRequired: urlRequiredConfig.indexOf(typesConfig[ctr]) >= 0,
            format: format,
            exemptionDetailsRequired: exemptionDetailsConfig.indexOf(typesConfig[ctr]) >= 0
          });
        }
      }

      req.legacyUserContext.render(req, res, 'org/requestRepo', 'Request a a new repository', {
        orgName: orgName,
        orgConfig: org.inner.settings,
        allowPrivateRepos: allowPrivateRepos,
        allowPublicRepos: allowPublicRepos,
        orgHasCla: orgHasCla,
        claTeams: claTeams,
        approvers: approvers,
        teams: teams,
        org: org,
        selectTeams: selectTeams,
        templates: createMetadata.templates,
        approvalTypes: approvalTypes,
        languages: languages,
      });
    });
  });
});

function getApproverMembers(team, cb) {
  if (team == null) {
    cb(null, []);
    return;
  }
  team.getMemberLinks(cb);
}

function getRequestApprovalPkg(requestId, legacyUserContext, dc, operations, cb) {
  dc.getApprovalRequest(requestId, function (error, pendingRequest) {
    if (error) {
      cb(utils.wrapError(error, 'The pending request you are looking for does not seem to exist.'), null);
    }
    operations.getAccountWithDetailsAndLink(pendingRequest.ghid, (getAccountError, requestingUserAccount) => {
      if (getAccountError) {
        return cb(getAccountError);
      }
      requestingUser = users[pendingRequest.ghu];
      var approvalPackage = {
        request: pendingRequest,
        requestingUser: requestingUserAccount,
        id: requestId,
      };
      cb(null, approvalPackage);
    });
  });
}

module.exports = router;
