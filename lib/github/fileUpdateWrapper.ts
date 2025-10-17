//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from '../../business/index.js';
import { CreateError } from '../transitional.js';
import { GitHubRepositoryPermission } from '../../interfaces/github/repos.js';

import type { IProviders } from '../../interfaces/providers.js';
import type { IRepositoryWorkflowOutput } from '../../routes/org/repoWorkflowEngine.js';

export interface IRepositoryCommitterOptions {
  isUsingApp: boolean;
  alternateToken: string;
  login: string;
}

export class RepositoryFileWrapper {
  private _hasAuthorizedTemplateCommitter = false;
  private _contentCommitter: IRepositoryCommitterOptions;

  constructor(
    private providers: IProviders,
    private repository: Repository,
    private log?: IRepositoryWorkflowOutput[]
  ) {}

  async authorizeCommitter() {
    if (this._contentCommitter) {
      return this._contentCommitter;
    }
    const { config } = this.providers;
    this._contentCommitter = {
      isUsingApp: true,
      login: null,
      alternateToken: null,
    };
    if (config?.github?.user?.initialCommit?.username && config.github.user.initialCommit.token) {
      const login = config.github.user.initialCommit.username;
      const alternateToken = config.github.user.initialCommit.token;
      if (!this._hasAuthorizedTemplateCommitter) {
        try {
          this._contentCommitter = {
            login,
            alternateToken,
            isUsingApp: false,
          };
          await this.prepareCommit();
        } catch (error) {
          const err = CreateError.Wrap(`Error trying to authorize template committer ${login}`, error);
          if (this.log) {
            this.log.push({ error: err });
          } else {
            throw err;
          }
        }
      }
    }
    return this._contentCommitter;
  }

  async finalizeCommit() {
    if (!this._hasAuthorizedTemplateCommitter) {
      return;
    }
    const { login } = await this.authorizeCommitter();
    if (login) {
      try {
        await this.repository.removeCollaborator(login);
        if (this.log) {
          this.log.push({ message: `Temporary committer ${login} removed` });
        }
        this._hasAuthorizedTemplateCommitter = false;
      } catch (error) {
        const err = CreateError.Wrap(`Error trying to remove template committer ${login}`, error);
        if (this.log) {
          this.log.push({ error: err });
        } else {
          throw err;
        }
      }
    }
  }

  async prepareCommit() {
    const options = this._contentCommitter;
    if (this._hasAuthorizedTemplateCommitter) {
      return;
    }
    const invitation = await this.repository.addCollaborator(options.login, GitHubRepositoryPermission.Push);
    let hadError = false;
    if (invitation?.id) {
      try {
        await this.repository.acceptCollaborationInvite(invitation.id, {
          alternateToken: options.alternateToken,
        });
      } catch (error) {
        const err = CreateError.Wrap(
          `Error trying to accept collaboration invitation for ${options.login}`,
          error
        );
        if (this.log) {
          this.log.push({ error: err });
        } else {
          throw err;
        }
        hadError = true;
      }
    }
    if (!hadError) {
      if (this.log) {
        this.log.push({ message: `Temporarily invited ${options.login} to commit to the repository` });
      }
      this._hasAuthorizedTemplateCommitter = true;
    }
  }
}
