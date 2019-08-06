//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn"] }] */

import async from 'async';
import fs from 'fs';
import path from 'path';

import recursiveReadDirectory from 'recursive-readdir';

import { wrapError } from '../../utils';
import { Organization, ICreateRepositoryResult } from '../../business/organization';
import { Operations } from '../../business/operations';
import { RepositoryMetadataEntity, GitHubRepositoryVisibility, GitHubRepositoryPermission } from '../../entities/repositoryMetadata/repositoryMetadata';
import { Repository } from '../../business/repository';

export interface IApprovalPackage {
  id: string;
  // requestingUser: string;
  repositoryMetadata: RepositoryMetadataEntity;
}

export enum RepoWorkflowDecision {
  Approve = 'approve',
  Deny = 'deny',
}

export class RepoWorkflowEngine {
  organization: Organization;
  request: RepositoryMetadataEntity;
  user: string;
  id: string;
  typeName: string;

  constructor(organization: Organization, approvalPackage: IApprovalPackage) {
    this.request = approvalPackage.repositoryMetadata;
    // this.user = approvalPackage.requestingUser;
    this.id = approvalPackage.id;
    this.organization = organization;
    this.typeName = 'Repository Create';
  }

  editGet(req, res) {
    req.individualContext.webContext.render({
      view: 'org/team/approvals/editRepo',
      title: 'Edit Repo Request',
      state: {
        entry: this.request,
        teamUrl: req.teamUrl,
        team: req.team,
      },
    });
  }

  editPost(req, res, next) {
    const destructured = this.organization.getLegacySystemObjects();
    const operations = destructured[1] as Operations;
    const repositoryMetadataProvider = operations.providers.repositoryMetadataProvider;
    const visibility = req.body.repoVisibility;
    if (!(visibility == 'public' || visibility == 'private')) {
      return next(new Error('Visibility for the repo request must be provided.'));
    }
    this.request.repositoryName = req.body.repoName;
    this.request.initialRepositoryVisibility = visibility === 'public' ? GitHubRepositoryVisibility.Public : GitHubRepositoryVisibility.Private;
    this.request.initialRepositoryDescription = req.body.repoDescription;
    // this ... repoUrl = req.body.repoUrl
    repositoryMetadataProvider.updateRepositoryMetadata(this.request).then(ok => {
      return res.redirect(req.teamUrl + 'approvals/' + this.id);
    }).catch(error => {
      return next(wrapError(error, 'There was a problem updating the request.'));
    });
  }

  getApprovedViewName() {
    return 'org/team/repos/repoCreated';
  }

  getDecisionEmailViewName() {
    return 'repoApprovals/decision';
  }

  generateSecondaryTasks(callback) {
    const pendingRequest = this.request;
    const tasks = [];
    const organization = this.organization;
    const repoName = pendingRequest.repositoryName;
    for (let i = 0; i < pendingRequest.initialTeamPermissions.length; i++) {
      const { teamId, permission, teamName } = pendingRequest.initialTeamPermissions[i];
      if (teamId && permission) {
        tasks.push(createAddRepositoryTask(organization, repoName, teamId, teamName, permission));
      }
    }
    if (pendingRequest.initialTemplate) {
      tasks.push(createAddTemplateFilesTask(organization, repoName, pendingRequest.initialTemplate));
    }
    // TODO: NEW: WEBHOOK SUPPORT FOR DOCS TEAM
    return callback(null, tasks);
  }

  performApprovalOperation(callback) {
    const properties = {
      description: this.request.initialRepositoryDescription,
      'private': this.request.initialRepositoryVisibility === GitHubRepositoryVisibility.Public ? false : true,
      gitignore_template: this.request.initialGitIgnoreTemplate,
    };
    const organization = this.organization;
    organization.createRepository(this.request.repositoryName, properties, function (error, result: ICreateRepositoryResult) {
      const response = result.response;
      if (error) {
        error = wrapError(error, `The GitHub API did not allow the creation of the new repo ${this.request.repositoryName}. ${error.message}`);
      }
      callback(error, response);
    });
  }
}

function createAddRepositoryTask(organization: Organization, repoName: string, id: string, teamName: string, permission: GitHubRepositoryPermission) {
  return function (cb) {
    async.retry({
      times: 3,
      interval: function (retryCount) {
        return 500 * Math.pow(2, retryCount);
      }
    }, function (callback) {
      organization.repository(repoName).setTeamPermission(id, permission, callback);
    }, function (error) {
      // Don't propagate as an error, just record the issue...
      const teamIdentity = teamName ? `${teamName} (${id})` : `with the ID ${id}`;
      let message = `Successfully added the ${repoName} repo to GitHub team ${teamIdentity} with ${permission.toUpperCase()} permissions.`;
      if (error) {
        message = `The addition of the repo ${repoName} to GitHub team ${teamIdentity} failed. GitHub returned an error: ${error.message}.`;
      }
      const result = {
        error: error,
        message: message,
      };
      return cb(null, result);
    });
  };
};

async function getFileContents(templateRoot:string, templatePath: string, templateName: string, absoluteFileNames: string[]): Promise<IFileContents[]> {
  const contents = [];
  for (let i = 0; i < absoluteFileNames.length; i++) {
    const absoluteFileName = absoluteFileNames[i];
    const fileName = path.relative(templateRoot, absoluteFileName);
    const fileContents = await readFileToBase64(templatePath, templateName, fileName);
    contents.push(fileContents);
  }
  return contents;
}

interface IFileContents {
  path: string;
  content: string; // base 64 content
}

async function getTemplateFilenames(templateRoot: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    recursiveReadDirectory(templateRoot, (error, fileNames: string[]) => {
      return error ? reject(error) : resolve(fileNames);
    });
  });
}

async function readFileToBase64(templatePath: string, templateName: string, fileName: string): Promise<IFileContents> {
  return new Promise((resolve, reject) => {
    fs.readFile(path.join(templatePath, templateName, fileName), (error, file) => {
      if (error) {
        return reject(error);
      }
      const base64content = file.toString('base64');
      return resolve({
        path: fileName,
        content: base64content,
      });
    });
  });
}

function createAddTemplateFilesTask(organization: Organization, repoName: string, templateName: string) {
  const destructured = organization.getLegacySystemObjects(); // const [, operations] =
  const operations = destructured[1] as Operations;
  const config = operations.config;
  const templatePath = config.github.templates.directory;
  const userName = config.github.user.initialCommit.username;
  const token = config.github.user.initialCommit.token;
  const alternateTokenOptions = {
    alternateToken: token,
  };
  const repository = organization.repository(repoName);
  return (taskCallback) => {
    createAddTemplateFilesTaskAsync({
      repository,
      templateGitHubCommitterUsername: userName,
      alternateTokenOptions,
      templatePath,
      templateName,
    }).then(templateUploadResults => {
      return taskCallback(null, templateUploadResults);
    }).catch(error => {
      return taskCallback(error);
    });
  };
}

async function authorizeTemplateCommitterAccount(repository: Repository, templateGitHubCommitterUsername: string, alternateTokenOptions): Promise<void> {
  const invitation = await repository.addCollaboratorAsync(templateGitHubCommitterUsername, GitHubRepositoryPermission.Push);
  if (invitation === undefined || invitation === null) {
    // user already had permission
    return;
  }
  if (!invitation.id) {
    throw new Error(`The system account ${templateGitHubCommitterUsername} could not be invited to the ${repository.name} repository to apply the template.`);
  }
  const invitationId = invitation.id;
  const blah = await repository.acceptCollaborationInviteAsync(invitationId, alternateTokenOptions);
  console.log();
}
interface ITemplateUploadResult {
  error?: any;
  message: string;
}

async function createAddTemplateFilesTaskAsync({
  repository,
  templateGitHubCommitterUsername,
  alternateTokenOptions,
  templatePath,
  templateName,
}: {
  repository: Repository,
  templateGitHubCommitterUsername: string,
  alternateTokenOptions,
  templatePath: string,
  templateName: string,
}): Promise<ITemplateUploadResult> {
  await authorizeTemplateCommitterAccount(repository, templateGitHubCommitterUsername, alternateTokenOptions);
  const templateRoot = path.join(templatePath, templateName);
  const fileNames = await getTemplateFilenames(templateRoot);
  const fileContents = await getFileContents(templateRoot, templatePath, templateName, fileNames);
  const message = 'Initial commit';
  const uploadedFiles = [];
  let result = {
    error: null,
    message: null,
  };
  try {
    for (let i = 0; i < fileContents.length; i++) {
      const item = fileContents[i];
      await repository.createFileAsync(item.path, item.content, message, alternateTokenOptions);
      uploadedFiles.push(item.path);
    }
    result.message = `Initial commit of ${uploadedFiles.join(', ')} template files to the ${repository.name} repo succeeded.`;
  } catch (commitError) {
    result.error = commitError;
    const notUploaded = fileContents.map(fc => fc.path).filter(f => !uploadedFiles.includes(f));
    if (uploadedFiles.length) {
      result.message = `Initial commit of ${uploadedFiles.join(', ')} template files to the ${repository.name} repo partially succeeded. Not uploaded: ${notUploaded.join(', ')}. Error: ${commitError.message}`;
    } else {
      result.message = `Initial commit of template file(s) to the ${repository.name} repo failed. Not uploaded: ${notUploaded.join(', ')}. Error: ${commitError.message}.`;
    }
  }
  await repository.removeCollaboratorAsync(templateGitHubCommitterUsername);
  return result;
}
