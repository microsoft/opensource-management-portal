//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';
import fs from 'fs';
import path from 'path';
import recursiveReadDirectory from 'recursive-readdir';

import { wrapError, sleep } from '../../lib/utils';
import { Organization } from '../../business';
import { RepositoryMetadataEntity } from '../../business/entities/repositoryMetadata/repositoryMetadata';
import { Repository } from '../../business';
import { CreateRepositoryEntrypoint, ICreateRepositoryApiResult } from '../../api/createRepo';
import {
  CoreCapability,
  GitHubRepositoryPermission,
  GitHubRepositoryPermissions,
  GitHubRepositoryVisibility,
  IAlternateTokenOption,
  IOperationsRepositoryMetadataProvider,
  IProviders,
  IReposAppWithTeam,
  throwIfNotCapable,
} from '../../interfaces';
import { ErrorHelper } from '../../lib/transitional';
import {
  setupRepositoryReadmeSubstring,
  setupRepositorySubstring,
} from '../../business/features/newRepositories/strings';

export interface IApprovalPackage {
  id: string;
  // requestingUser: string;
  repositoryMetadata: RepositoryMetadataEntity;
  createResponse: unknown;
  isUnlockingExistingRepository: number | string | boolean | null | undefined;
  isFork: boolean;
  isTransfer: boolean;
  createEntrypoint: CreateRepositoryEntrypoint;
  repoCreateResponse: ICreateRepositoryApiResult;
}

interface IFileContents {
  path: string;
  content: string; // base 64 content
}

export enum RepoWorkflowDecision {
  Approve = 'approve',
  Deny = 'deny',
}

export interface IRepositoryWorkflowOutput {
  error?: any;
  message?: string;
}

interface ICommitterOptions {
  isUsingApp: boolean;
  alternateTokenOptions: IAlternateTokenOption;
  alternateToken: string;
  login: string;
}

export class RepoWorkflowEngine {
  organization: Organization;
  request: RepositoryMetadataEntity;
  user: string;
  id: string;
  typeName: string;
  private createResponse?: unknown;
  private isUnlockingExistingRepository: boolean;
  private isFork: boolean;
  private isTransfer: boolean;

  private githubResponse: ICreateRepositoryApiResult;

  private createEntrypoint: CreateRepositoryEntrypoint;

  private _hasAuthorizedTemplateCommitter = false;
  private _contentCommitter: ICommitterOptions;

  private log: IRepositoryWorkflowOutput[] = [];
  private repository: Repository;

  constructor(
    private providers: IProviders,
    organization: Organization,
    approvalPackage: IApprovalPackage
  ) {
    this.request = approvalPackage.repositoryMetadata;
    // this.user = approvalPackage.requestingUser;
    this.id = approvalPackage.id;
    this.organization = organization;
    this.typeName = 'Repository Create';
    this.githubResponse = approvalPackage?.repoCreateResponse;
    this.createResponse = approvalPackage.createResponse;
    this.isUnlockingExistingRepository = !!approvalPackage.isUnlockingExistingRepository;
    this.isFork = approvalPackage.isFork;
    this.isTransfer = approvalPackage.isTransfer;
    this.createEntrypoint = approvalPackage.createEntrypoint;
  }

  private async getTemplateCommitter() {
    if (this._contentCommitter) {
      return this._contentCommitter;
    }
    const { config } = this.providers;
    this._contentCommitter = {
      isUsingApp: true,
      login: null,
      alternateTokenOptions: null,
      alternateToken: null,
    };
    if (config?.github?.user?.initialCommit?.username && config.github.user.initialCommit.token) {
      const login = config.github.user.initialCommit.username;
      const alternateToken = config.github.user.initialCommit.token;
      const alternateTokenOptions = {
        alternateToken,
      };
      if (!this._hasAuthorizedTemplateCommitter) {
        try {
          await this.authorizeTemplateCommitter({
            login,
            alternateToken,
            alternateTokenOptions,
            isUsingApp: false,
          });
        } catch (error) {
          this.log.push({
            error: new Error(`Error trying to authorize template committer ${login}: ${error}`),
          });
        }
      }
    }
    return this._contentCommitter;
  }

  private async finalizeCommitter() {
    if (!this._hasAuthorizedTemplateCommitter) {
      return;
    }
    const { login } = await this.getTemplateCommitter();
    if (login && this.repository) {
      try {
        await this.repository.removeCollaborator(login);
        this.log.push({ message: `Temporary committer ${login} removed` });
      } catch (error) {
        this.log.push({ error: new Error(`Error removing committer ${login}: ${error}`) });
      }
    }
    this._hasAuthorizedTemplateCommitter = false;
  }

  private async authorizeTemplateCommitter(options: ICommitterOptions) {
    if (!options.login) {
      return;
    }
    const invitation = await this.repository.addCollaborator(options.login, GitHubRepositoryPermission.Push);
    let hadError = false;
    if (invitation?.id) {
      try {
        await this.repository.acceptCollaborationInvite(invitation.id, options.alternateTokenOptions);
      } catch (error) {
        hadError = true;
        this.log.push({
          error: new Error(
            `The collaboration invitation could not be accepted for ${options.login}: ${error}`
          ),
        });
      }
    }
    if (!hadError) {
      this.log.push({ message: `Temporarily invited ${options.login} to commit to the repository` });
      this._contentCommitter = options;
      this._hasAuthorizedTemplateCommitter = true;
    }
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

  editPost(req: IReposAppWithTeam, res: Response, next: NextFunction) {
    const { operations } = this.providers;
    const ops = throwIfNotCapable<IOperationsRepositoryMetadataProvider>(
      operations,
      CoreCapability.RepositoryMetadataProvider
    );
    const repositoryMetadataProvider = ops.repositoryMetadataProvider;
    const visibility = req.body.repoVisibility;
    if (!(visibility === 'public' || visibility === 'private' || visibility === 'internal')) {
      return next(new Error('Visibility for the repo request must be provided.'));
    }
    this.request.repositoryName = req.body.repoName;
    this.request.initialRepositoryVisibility = visibility; // visibility === 'public' ? GitHubRepositoryVisibility.Public : GitHubRepositoryVisibility.Private;
    this.request.initialRepositoryDescription = req.body.repoDescription;
    // this ... repoUrl = req.body.repoUrl
    repositoryMetadataProvider
      .updateRepositoryMetadata(this.request)
      .then((ok) => {
        return res.redirect(req.teamUrl + 'approvals/' + this.id);
      })
      .catch((error) => {
        return next(wrapError(error, 'There was a problem updating the request.'));
      });
  }

  getApprovedViewName() {
    return 'org/team/repos/repoCreated';
  }

  getDecisionEmailViewName() {
    return 'repoApprovals/decision';
  }

  async executeNewRepositoryChores(): Promise<IRepositoryWorkflowOutput[] /* output */> {
    const request = this.request;
    const repositoryName = request.repositoryName;
    this.repository = this.organization.repository(repositoryName);
    for (let i = 0; i < request.initialTeamPermissions.length; i++) {
      let { teamId, permission, teamName } = request.initialTeamPermissions[i];
      if (teamId && !teamName) {
        try {
          const team = this.organization.team(Number(teamId));
          await team.getDetails();
          if (team.name) {
            teamName = team.name;
          }
        } catch (noFail) {
          /* ignore */
        }
      }
      if (teamId && permission) {
        await this.addTeamPermission(Number(teamId), teamName, permission);
      }
    }
    const patchUpdates: any = {};
    if (
      request.initialRepositoryVisibility === GitHubRepositoryVisibility.Public &&
      this.githubResponse?.github?.private === true
    ) {
      // Time to make it public again. Though this is debatable.
      patchUpdates.private = false;
    }
    if (
      request.initialRepositoryDescription &&
      this.githubResponse?.github?.description !== request.initialRepositoryDescription
    ) {
      patchUpdates.description = request.initialRepositoryDescription;
    } else if (this.githubResponse?.github?.description?.includes(setupRepositorySubstring)) {
      patchUpdates.description = '';
    }
    const setupUrlSubstring = this.organization.absoluteBaseUrl;
    if (
      request.initialRepositoryHomepage &&
      this.githubResponse?.github?.homepage !== request.initialRepositoryHomepage
    ) {
      patchUpdates.homepage = request.initialRepositoryHomepage;
    } else if (this.githubResponse?.github?.homepage?.includes(setupUrlSubstring)) {
      patchUpdates.homepage = '';
    }
    if (Object.getOwnPropertyNames(patchUpdates).length > 0) {
      await this.resetOriginalProperties(patchUpdates);
    }
    if (request.initialTemplate) {
      try {
        await this.addTemplateCollaborators(request.initialTemplate);
        await this.createAddTemplateFilesTask(
          request.initialTemplate,
          this.isUnlockingExistingRepository,
          this.isFork,
          this.isTransfer
        );
        await this.addTemplateWebHook(request.initialTemplate);
      } catch (outerError) {
        // ignored
        console.dir(outerError);
      }
    } else {
      try {
        await this.tryResetReadme(request?.initialRepositoryDescription);
      } catch (outerError) {
        console.dir(outerError);
      }
    }
    // GitHub adds the creator of a repo (when using a PAT) as an admin directly now, but we don't need that...
    await this.removeOrganizationCollaboratorTask();

    // Add any administrator logins as invited, if present
    if (request.initialAdministrators && request.initialAdministrators.length > 0) {
      await this.addAdministratorCollaboratorsTask(request.initialAdministrators);
    }

    await this.finalizeCommitter();
    return this.log.filter((real) => real);
  }

  async addTeamPermission(
    id: number,
    teamName: string,
    permission: GitHubRepositoryPermission
  ): Promise<void> {
    let attempts = 0;
    const calculateDelay = (retryCount: number) => 500 * Math.pow(2, retryCount);
    let error = null;
    const teamIdentity = teamName ? `${teamName} (${id})` : `with the ID ${id}`;
    while (attempts < 3) {
      try {
        await this.repository.setTeamPermission(id, permission);
        this.log.push({
          message: `Successfully added the ${
            this.repository.name
          } repo to GitHub team ${teamIdentity} with ${permission.toUpperCase()} permissions.`,
        });
        return;
      } catch (iterationError) {
        error = iterationError;
      }
      const nextInterval = calculateDelay(attempts++);
      await sleep(nextInterval);
    }
    const message = `The addition of the repo ${this.repository.name} to GitHub team ${teamIdentity} failed. GitHub returned an error: ${error.message}.`;
    this.log.push({ error, message });
  }

  async getFileContents(
    templateRoot: string,
    templatePath: string,
    templateName: string,
    absoluteFileNames: string[]
  ): Promise<IFileContents[]> {
    const contents = [];
    for (let i = 0; i < absoluteFileNames.length; i++) {
      const absoluteFileName = absoluteFileNames[i];
      const fileName = path.relative(templateRoot, absoluteFileName);
      const fileContents = await this.readFileToBase64(templatePath, templateName, fileName);
      contents.push(fileContents);
    }
    return contents;
  }

  async getTemplateFilenames(templateRoot: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      recursiveReadDirectory(templateRoot, (error, fileNames: string[]) => {
        return error ? reject(error) : resolve(fileNames);
      });
    });
  }

  async readFileToBase64(
    templatePath: string,
    templateName: string,
    fileName: string
  ): Promise<IFileContents> {
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

  async addTemplateWebHook(templateName: string): Promise<void> {
    const { config } = this.providers;
    const definitions = config.github.templates.definitions;
    const templateData = definitions ? definitions[templateName] : null;
    if (!templateData || !templateData.webhook) {
      return null;
    }

    const webhook = templateData.webhook;
    const webhookSharedSecret = templateData.webhookSharedSecret;
    const webhookEvents = templateData.webhookEvents;
    const webhookFriendlyName = templateData.webhookFriendlyName;
    let error = null;
    let message = null;
    const friendlyName = webhookFriendlyName || webhook;
    try {
      await this.repository.createWebhook({
        config: {
          url: webhook,
          content_type: 'json',
          secret: webhookSharedSecret,
          insecure_ssl: '0',
        },
        events: webhookEvents || ['push'],
      });
      message = `${friendlyName} webhook added to the repository.`;
    } catch (cause) {
      error = new Error(
        `The template ${templateName} defines a webhook ${friendlyName}. Adding the webhook failed. ${cause.message()}`,
        { cause }
      );
    }
    this.log.push({ error, message });
  }

  async removeOrganizationCollaboratorTask(): Promise<void> {
    const result = null;
    if (this.organization.usesApp) {
      // If a GitHub App created the repo, it is not present as a collaborator.
      return;
    }
    try {
      const createAccount = await this.organization.getAuthorizedOperationsAccount();
      await this.repository.removeCollaborator(createAccount.login);
    } catch (ignoredError) {
      if (ErrorHelper.GetStatus(ignoredError) === 400) {
        // GitHub App in use
      } else {
        console.warn(`removeOrganizationCollaboratorTask ignored error: ${ignoredError}`);
      }
    }
    return result;
  }

  async createAddTemplateFilesTask(
    templateName: string,
    isUnlockingExistingRepository: boolean,
    isFork: boolean,
    isTransfer: boolean
  ): Promise<void> {
    const { config } = this.providers;
    const templatePath = config.github.templates.directory;
    const { alternateTokenOptions } = await this.getTemplateCommitter();
    try {
      const templateRoot = path.join(templatePath, templateName);
      const fileNames = await this.getTemplateFilenames(templateRoot);
      const fileContents = await this.getFileContents(templateRoot, templatePath, templateName, fileNames);
      const uploadedFiles = [];
      if (isFork || isTransfer) {
        const subMessage = isFork ? 'is a fork' : 'was transferred';
        this.log.push({
          message: `Repository ${subMessage}, template files will not be committed. Please check the LICENSE and other files to understand existing obligations.`,
        });
        return;
      }
      try {
        for (let i = 0; i < fileContents.length; i++) {
          const item = fileContents[i];
          let sha = null;
          // if (isUnlockingExistingRepository) {
          try {
            const fileDescription = await this.repository.getFile(item.path);
            if (fileDescription && fileDescription.sha) {
              sha = fileDescription.sha;
            }
          } catch (getFileError) {
            if (getFileError.status === 404) {
              // often the file will not exist, that's great.
            } else {
              throw getFileError;
            }
          }
          // }
          const fileOptions = sha ? { ...alternateTokenOptions, sha } : alternateTokenOptions;
          const message = sha ? `${item.path} updated to template` : `${item.path} committed`;
          await this.repository.createFile(item.path, item.content, message, fileOptions);
          uploadedFiles.push(item.path);
        }
      } catch (error) {
        const notUploaded = fileContents.map((fc) => fc.path).filter((f) => !uploadedFiles.includes(f));
        if (uploadedFiles.length) {
          this.log.push({
            error,
            message: `Initial commit of ${uploadedFiles.join(', ')} template files to the ${
              this.repository.name
            } repo partially succeeded. Not uploaded: ${notUploaded.join(', ')}. Error: ${error.message}`,
          });
        } else {
          this.log.push({
            error,
            message: `Initial commit of template file(s) to the ${
              this.repository.name
            } repo failed. Not uploaded: ${notUploaded.join(', ')}. Error: ${error.message}.`,
          });
        }
      }
    } catch (error) {
      this.log.push({ error });
    }
  }

  async addAdministratorCollaboratorsTask(administratorLogins: string[]): Promise<void> {
    if (!administratorLogins || !administratorLogins.length) {
      return null;
    }
    const errors = [];
    const messages = [];
    for (const login of administratorLogins) {
      try {
        await this.repository.addCollaborator(login, GitHubRepositoryPermission.Admin);
        messages.push(`Added collaborator ${login} with admin permission`);
      } catch (error) {
        errors.push(error.message);
      }
    }
    let error = null;
    let message = null;
    if (errors.length) {
      error = errors.join(', ');
    } else {
      message = messages.join(', ');
    }
    this.log.push({ error, message });
  }

  async resetOriginalProperties(patch: any): Promise<void> {
    let error: Error = null;
    let message: string = null;
    try {
      const description = 'Patching original values for ' + Object.getOwnPropertyNames(patch).join(', ');
      await this.repository.update(patch);
      message = description;
    } catch (err) {
      error = new Error(`Error patching: ${err}`);
    }
    this.log.push({ error, message });
  }

  async tryResetReadme(initialDescription: string): Promise<void> {
    let error: Error = null;
    let message: string = null;
    try {
      const readmeFile = await this.repository.getReadme();
      const sha = readmeFile.sha;
      if (readmeFile.content?.includes(setupRepositoryReadmeSubstring)) {
        message = `Updating ${readmeFile.path}`;
        const descriptionSection = initialDescription ? `\n\n${initialDescription}` : '';
        const newReadmeFile = `# ${this.repository.name}${descriptionSection}`;
        const asBuffer = Buffer.from(newReadmeFile, 'utf-8');
        const asBase64 = asBuffer.toString('base64');
        await this.repository.createFile(readmeFile.path, asBase64, 'Initial README', { sha });
      }
    } catch (err) {
      if (ErrorHelper.IsNotFound(err)) {
        message = 'No README.md file to update.';
      } else {
        error = new Error(`Could not reset README content: ${err}`);
      }
    }
    this.log.push({ error, message });
  }

  async addTemplateCollaborators(templateName: string): Promise<void> {
    const { config } = this.providers;
    const definitions = config.github.templates.definitions;
    const templateData = definitions ? definitions[templateName] : null;
    if (!templateData || !templateData.collaborators) {
      return null;
    }
    const collaborators = templateData.collaborators;
    const errors = [];
    const messages = [];
    for (const permission of GitHubRepositoryPermissions) {
      const users = collaborators[permission];
      if (users && Array.isArray(users)) {
        for (const { username, acceptInvitationToken } of users) {
          try {
            const invitation = await this.repository.addCollaborator(username, permission);
            messages.push(`Added collaborator ${username} with ${permission} permission`);
            if (acceptInvitationToken) {
              const invitationId = invitation.id;
              await this.repository.acceptCollaborationInvite(invitationId, acceptInvitationToken);
            }
          } catch (error) {
            errors.push(error.message);
          }
        }
      }
    }
    let error = null;
    let message = null;
    if (errors.length) {
      error = errors.join(', ');
    } else {
      message = messages.join(', ');
    }
    this.log.push({ error, message });
  }
}
