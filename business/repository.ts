//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import moment from 'moment';

import * as common from './common.js';
import {
  Organization,
  getMaxAgeSeconds,
  CacheDefault,
  getPageSize,
  RepositoryPermission,
  Collaborator,
  TeamPermission,
  RepositoryIssue,
  Operations,
} from './index.js';
import { RepositoryMetadataEntity } from './entities/repositoryMetadata/repositoryMetadata.js';
import { AppPurpose, AppPurposeTypes } from '../lib/github/appPurposes.js';
import {
  PurposefulGetAuthorizationHeader,
  ICacheOptions,
  IGetBranchesOptions,
  IGitHubBranch,
  IGetPullsOptions,
  ITemporaryCommandOutput,
  NoCacheNoBackground,
  IGitHubProtectedBranchConfiguration,
  RepositoryBranchAccessProtections as RepositoryBranchAccessProtections,
  IListContributorsOptions,
  IGetCollaboratorsOptions,
  GitHubCollaboratorAffiliationQuery,
  IGitHubCollaboratorInvitation,
  ICreateWebhookOptions,
  IPagedCacheOptions,
  IGitHubSecretScanningAlert,
  GetAuthorizationHeader,
  IRepositoryGetIssuesOptions,
  GitHubRepositoryPermission,
  GitHubRepositoryVisibility,
  GitHubRepositoryDetails,
  RepositoryRulesetDefinition,
  RepositoryRuleset,
  IAlternateTokenOption,
} from '../interfaces/index.js';
import { IListPullsParameters, GitHubPullRequestState } from '../lib/github/collections.js';

import { wrapError } from '../lib/utils.js';
import { RepositoryActions } from './repositoryActions.js';
import { RepositoryPullRequest } from './repositoryPullRequest.js';
import { CreateError, ErrorHelper } from '../lib/transitional.js';
import { RepositoryInvitation } from './repositoryInvitation.js';
import { RepositoryProperties } from './repositoryProperties.js';
import { WithGitHubRestHeaders } from '../lib/github/core.js';
import { RepositoryAdvisories } from './repositoryAdvisories.js';

type RepositoryMoments = {
  created?: moment.Moment;
  updated?: moment.Moment;
  pushed?: moment.Moment;
};

type RepositoryMomentsAgo = {
  created?: string;
  updated?: string;
  pushed?: string;
};

type NewIssueOptions = {
  assignees?: string[];
  labels?: string[];
};

type ProtectedBranchRule = {
  pattern: string;
};

type GitHubNewProjectOptions = {
  body?: string;
};

interface IGitHubGetFileParameters {
  owner: string;
  repo: string;
  path: string;
  ref?: string;

  alternateToken?: string;
}

type GitHubGetReadmeParameters = {
  owner: string;
  repo: string;
  ref?: string;
};

export type GitHubFileContents = {
  type: string;
  encoding: 'base64';
  size: number;
  name: string;
  path: string;
  content: string;
  sha: string;
  url: string;
  git_url: string;
  html_url: string;
  download_url: string;
  _links: {
    git: string;
    self: string;
    html: string;
  };
};

type CreateFileParameters = {
  owner: string;
  repo: string;
  path: string;
  message: string;
  content: string;
  branch?: string;
  committer?: any;
  sha?: string;

  alternateToken?: string;
};

type GitHubGetFileOptions = {
  ref?: string;
};

interface IGitHubGetReadmeOptions extends ICacheOptions {
  ref?: string;
}

type CreateFileOptions = {
  branch?: string;
  committer?: any;
  alternateToken?: string;
  sha?: string;
};

type GetBranchesParameters = {
  owner: string;
  repo: string;
  per_page: number;
  protected?: boolean;
};

type UnarchiveResponse = {
  unarchiveRepository: {
    repository: {
      isArchived: boolean;
    };
  };
};

export type GitHubBranchProtectionParameters = {
  owner: string;
  repo: string;
  branch: string;
  required_status_checks: {
    strict: boolean;
    contexts: string[];
    checks?: string[];
  } | null;
  enforce_admins: boolean | null;
  required_pull_request_reviews: {
    dismissal_restrictions: {
      users: string[];
      teams: string[];
      apps: string[];
    };
    dismiss_stale_reviews: boolean;
    require_code_owner_reviews: boolean;
    required_approving_review_count: number;
    require_last_push_approval: boolean;
    bypass_pull_request_allowances: {
      users: string[];
      teams: string[];
      apps: string[];
    };
  } | null;
  restrictions: {
    users: string[];
    teams: string[];
    apps: string[];
  };
  required_linear_history: boolean;
  allow_force_pushes: boolean | null;
  allow_deletions: boolean;
  block_creations: boolean;
  required_conversation_resolution: boolean;
  lock_branch: boolean;
  allow_fork_syncing: boolean;
};

export type GitHubPagesResponse = {
  status: string;
  cname: string;
  custom_404: boolean;
  build_type: string;
  html_url: string;
  source: {
    branch: string;
    path: string;
  };
  public: boolean;
  https_certificate: unknown;
  protected_domain_state: GitHubPagesProtectedDomainState;
  pending_domain_unverified_at: string;
  https_enforced: string;
};

export enum GitHubPagesProtectedDomainState {
  Pending = 'pending',
  Verified = 'verified',
}

const safeEntityFieldsForJsonSend = [
  'fork',
  'name',
  'size',
  'forks',
  'license',
  'private',
  'archived',
  'disabled',
  'homepage',
  'language',
  'watchers',
  'pushed_at',
  'created_at',
  'updated_at',
  'description',
  'forks_count',
  'watchers_count',
  'stargazers_count',
  'open_issues_count',
  'id',
];

export class Repository {
  private _entity: WithGitHubRestHeaders<GitHubRepositoryDetails>;
  private _baseUrl: string;
  private _absoluteBaseUrl: string;
  private _nativeUrl: string;
  private _nativeManagementUrl: string;

  private _awesomeness: number;

  private _getAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _getOptimizedAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _operations: Operations;

  private _organization: Organization;
  private _customProperties: RepositoryProperties;

  private _name: string;

  private _moments: RepositoryMoments;

  getEntity(): WithGitHubRestHeaders<GitHubRepositoryDetails> {
    return this._entity;
  }

  asJson() {
    const organizationSubset = {
      organization: {
        login: this.organization.name,
        id: this.organization.id,
      },
    };
    const entity = this.getEntity();
    const safeClone = {};
    for (let i = 0; i < safeEntityFieldsForJsonSend.length; i++) {
      const key = safeEntityFieldsForJsonSend[i];
      if (entity[key] !== undefined) {
        safeClone[key] = entity[key];
      }
    }
    return Object.assign(organizationSubset, safeClone);
  }

  get id(): number {
    return this._entity ? this._entity.id : null;
  }
  get name(): string {
    return this._entity ? this._entity.name : this._name;
  }
  get full_name(): string {
    return this._entity ? this._entity.full_name : null;
  }
  get private(): boolean {
    return this._entity ? this._entity.private : false;
  }
  get visibility(): GitHubRepositoryVisibility {
    return this._entity ? this._entity.visibility : null;
  }
  get html_url(): string {
    return this._entity ? this._entity.html_url : null;
  }
  get description(): string {
    return this._entity ? this._entity.description : null;
  }
  get fork(): boolean {
    return this._entity ? this._entity.fork : null;
  }
  // get url(): string {
  //   return this._entity ? this._entity.url : null;
  // }
  get archived(): boolean {
    return this._entity ? this._entity.archived : false;
  }
  get created_at(): string {
    return this._entity ? this._entity.created_at : null;
  }
  get updated_at(): string {
    return this._entity ? this._entity.updated_at : null;
  }
  get pushed_at(): string {
    return this._entity ? this._entity.pushed_at : null;
  }
  get git_url(): string {
    return this._entity ? this._entity.git_url : null;
  }
  get homepage(): string {
    return this._entity ? this._entity.homepage : null;
  }
  get size(): any {
    return this._entity ? this._entity.size : null;
  }
  get stargazers_count(): any {
    return this._entity ? this._entity.stargazers_count : null;
  }
  get watchers_count(): any {
    return this._entity ? this._entity.watchers_count : null;
  }
  get language(): string {
    return this._entity ? this._entity.language : null;
  }
  get has_issues(): boolean {
    return this._entity ? this._entity.has_issues : null;
  }
  get has_wiki(): boolean {
    return this._entity ? this._entity.has_wiki : null;
  }
  get has_pages(): boolean {
    return this._entity ? this._entity.has_pages : null;
  }
  get forks_count(): any {
    return this._entity ? this._entity.forks_count : null;
  }
  get open_issues_count(): any {
    return this._entity ? this._entity.open_issues_count : null;
  }
  get forks(): any {
    return this._entity ? this._entity.forks : null;
  }
  get open_issues(): any {
    return this._entity ? this._entity.open_issues : null;
  }
  get watchers(): any {
    return this._entity ? this._entity.watchers : null;
  }
  get license(): any {
    return this._entity ? this._entity.license : null;
  }
  get default_branch(): any {
    return this._entity ? this._entity.default_branch : null;
  }
  get clone_url(): any {
    return this._entity ? this._entity.clone_url : null;
  }
  get ssh_url(): any {
    return this._entity ? this._entity.ssh_url : null;
  }
  get parent(): any {
    return this._entity ? this._entity.parent : null;
  }

  get organization(): Organization {
    return this._organization;
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  get absoluteBaseUrl(): string {
    return this._absoluteBaseUrl;
  }

  get nativeUrl() {
    return this._nativeUrl;
  }

  get nativeManagementUrl() {
    return this._nativeManagementUrl;
  }

  constructor(
    organization: Organization,
    entity: any,
    getAuthorizationHeader: PurposefulGetAuthorizationHeader,
    getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader,
    operations: Operations
  ) {
    this._organization = organization;
    this._entity = entity;
    this._nativeUrl = organization.nativeUrl + this.name + '/';
    this._nativeManagementUrl = organization.nativeUrl + this.name + '/';
    let repositoriesDeliminator = 'repos/';
    repositoriesDeliminator = (operations as Operations).repositoriesDeliminator;
    this._absoluteBaseUrl = organization.absoluteBaseUrl + repositoriesDeliminator + this.name + '/';
    this._baseUrl = organization.baseUrl + repositoriesDeliminator + this.name + '/';
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._getSpecificAuthorizationHeader = getSpecificAuthorizationHeader;
    this._operations = operations;
  }

  get customProperties() {
    if (!this._customProperties) {
      this._customProperties = new RepositoryProperties(
        this,
        this._operations,
        this._getAuthorizationHeader.bind(this)
      );
    }
    return this._customProperties;
  }

  get moment(): RepositoryMoments {
    if (!this._moments) {
      this._moments = {
        updated: this.updated_at ? moment(this.updated_at) : undefined,
        pushed: this.pushed_at ? moment(this.pushed_at) : undefined,
        created: this.created_at ? moment(this.created_at) : undefined,
      };
    }
    return this._moments;
  }

  get momentDisplay(): RepositoryMomentsAgo {
    const moments = this.moment;
    return {
      updated: moments.updated ? moments.updated.fromNow() : undefined,
      created: moments.created ? moments.created.fromNow() : undefined,
      pushed: moments.pushed ? moments.pushed.fromNow() : undefined,
    };
  }

  async getId(options?: ICacheOptions): Promise<number> {
    // Repositories by name may not actually have the ID; this ensures it's available
    // and a number. Similar to previously checking "isDeleted" or "getDetails" first.
    if (!this.id) {
      await this.getDetails(options);
    }
    if (this.id) {
      return typeof this.id === 'number' ? this.id : parseInt(this.id, 10);
    }
  }

  async isDeleted(options?: ICacheOptions): Promise<boolean> {
    try {
      await this.getDetails(options);
    } catch (maybeDeletedError) {
      if (maybeDeletedError && maybeDeletedError.status && maybeDeletedError.status === 404) {
        return true;
      }
    }
    return false;
  }

  get actions() {
    return new RepositoryActions(
      this,
      this._getAuthorizationHeader,
      this._getSpecificAuthorizationHeader,
      this._operations
    );
  }

  get securityAdvisories() {
    return new RepositoryAdvisories(
      this,
      this._getAuthorizationHeader,
      this._getSpecificAuthorizationHeader,
      this._operations
    );
  }

  async getDetails(options?: ICacheOptions): Promise<WithGitHubRestHeaders<GitHubRepositoryDetails>> {
    options = options || {};
    const operations = this._operations as Operations;
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoDetailsStaleSeconds,
        options
      ),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    if ((options as any).noConditionalRequests === true) {
      (cacheOptions as any).noConditionalRequests = true;
    }
    // always prefer ID over name
    if (this.id) {
      try {
        const lookupById = await this.organization.getRepositoryById(this.id, cacheOptions);
        this._entity = lookupById.getEntity();
        this._name = this._entity.name;
        return this._entity;
      } catch (getByIdError) {
        throw getByIdError;
      }
    }
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    try {
      let entity: WithGitHubRestHeaders<GitHubRepositoryDetails> = undefined;
      const { github } = operations;
      const { rest } = github.octokit;
      const noConditionalRequests = (cacheOptions as any).noConditionalRequests === true;
      const purpose = noConditionalRequests ? AppPurpose.Operations : AppPurpose.Data;
      const requirements = github.createRequirementsForFunction(
        this.authorize(purpose),
        rest.repos.get,
        'repos.get'
      );
      if ((cacheOptions as any)?.noConditionalRequests === true) {
        entity = await github.postWithRequirements(requirements, parameters);
      } else {
        entity = await github.callWithRequirements(requirements, parameters, cacheOptions);
      }
      this._entity = entity;
      return entity;
    } catch (error) {
      const notFound = error.status && error.status == /* loose */ 404;
      error = wrapError(
        error,
        notFound ? 'The repo could not be found.' : 'Could not get details about the repo.',
        notFound
      );
      if (notFound) {
        error.status = 404;
      }
      throw error;
    }
  }

  async getGraphQlNodeId() {
    if (!this.getEntity()?.node_id) {
      await this.getDetails();
    }
    const { node_id: nodeId } = this.getEntity();
    return nodeId;
  }

  async getRepositoryMetadata(): Promise<RepositoryMetadataEntity> {
    const repositoryMetadataProvider = (this._operations as Operations).repositoryMetadataProvider;
    try {
      return await repositoryMetadataProvider.getRepositoryMetadata(this.id.toString());
    } catch (getMetadataError) {
      return null;
    }
  }

  async getBranches(cacheOptions: IGetBranchesOptions): Promise<IGitHubBranch[]> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const github = operations.github;
    const parameters: GetBranchesParameters = {
      owner: this.organization.name,
      repo: this.name,
      per_page: getPageSize(operations),
    };
    if (cacheOptions.protected !== undefined) {
      parameters.protected = cacheOptions.protected;
    }
    delete cacheOptions.protected;
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.repoBranchesStaleSeconds
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const { rest } = github.octokit;
    return github.collections.collectAllPagesWithRequirements<any, any>(
      'repoBranches',
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Data),
        rest.repos.listBranches,
        'repos.listBranches'
      ),
      parameters,
      cacheOptions,
      branchDetailsToCopy
    );
  }

  async getPulls(options?: IGetPullsOptions): Promise<any> {
    await this.organization.requireUpdatesApp('getPulls');
    // CONSIDER: might really need to probe for the app and pick which has pull request access
    const operations = this._operations as Operations;
    const github = operations.github;
    const cacheOptions: ICacheOptions = {};
    const parameters: IListPullsParameters = Object.assign({}, options || {}, {
      owner: this.organization.name,
      repo: this.name,
      per_page: getPageSize(operations),
    });
    if (options && options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
      delete parameters['backgroundRefresh'];
    }
    if (options && options.maxAgeSeconds !== undefined) {
      cacheOptions.maxAgeSeconds = options.maxAgeSeconds;
      delete parameters['maxAgeSeconds'];
    }
    if (cacheOptions.maxAgeSeconds === undefined) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.repoPullsStaleSeconds
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const { rest } = github.octokit;
    return github.collections.collectAllPagesWithRequirements<any, any>(
      'repoPullRequests',
      github.createRequirementsForFunction(this.authorize(AppPurpose.Data), rest.pulls.list, 'pulls.list'),
      parameters,
      cacheOptions,
      pullDetailsToCopy
    );
  }

  getReadme(options?: IGitHubGetReadmeOptions): Promise<GitHubFileContents> {
    options = options || {};
    const operations = this._operations as Operations;
    const parameters: GitHubGetReadmeParameters = {
      owner: this.organization.name,
      repo: this.name,
      ref: options?.ref || undefined,
    };
    if (options && options.ref) {
      parameters.ref = options.ref;
    }
    const cacheOptions: ICacheOptions = {};
    if (options?.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
      delete parameters['backgroundRefresh'];
    }
    if (options?.maxAgeSeconds !== undefined) {
      cacheOptions.maxAgeSeconds = options.maxAgeSeconds;
      delete parameters['maxAgeSeconds'];
    }
    if (cacheOptions?.maxAgeSeconds === undefined) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoDetailsStaleSeconds
      );
    }
    if (cacheOptions?.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const { github } = operations;
    const { rest } = github.octokit;
    return github.callWithRequirements(
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Operations),
        rest.repos.getReadme,
        'repos.getReadme'
      ),
      parameters,
      cacheOptions
    );
  }

  async getLastCommitToBranch(branchName: string): Promise<string> {
    await this.organization.requireUpdatesApp('getLastCommitToBranch');
    const options = {
      owner: this.organization.name,
      repo: this.name,
      ref: `heads/${branchName}`,
    };
    const operations = this._operations as Operations;
    const data = await operations.github.requestAsPost(
      this.authorize(AppPurpose.Updates),
      'GET /repos/:owner/:repo/git/ref/:ref',
      options
    );
    return data.object.sha;
  }

  async renameDefaultBranch(newBranchName?: string): Promise<ITemporaryCommandOutput[]> {
    newBranchName = newBranchName || 'main';
    await this.organization.requireUpdatesApp('renameDefaultBranch');
    const output: ITemporaryCommandOutput[] = [];
    try {
      await this.getDetails(NoCacheNoBackground);
      if (this.default_branch === newBranchName) {
        return [
          {
            message: `The default branch is already '${newBranchName}' for the repo ${this.full_name}. No further action required.`,
          },
        ];
      }
      const currentBranchName = this.default_branch;
      const sha = await this.getLastCommitToBranch(currentBranchName);
      // TODO: what if the branch already exists? Should let this keep running to update more PRs until done.
      await this.createNewBranch(sha, newBranchName);
      output.push({
        message: `Created a new branch '${newBranchName}' from '${currentBranchName}' which points to SHA ${sha}.`,
      });
      const branchProtectionRules = await this.listBranchProtectionRules();
      // there can only be one protection per pattern
      const branchProtection = branchProtectionRules.find(
        (rule: ProtectedBranchRule) => rule.pattern === currentBranchName
      );
      if (branchProtectionRules.length > 0) {
        const branchMessage = branchProtection
          ? `. The default branch is protected and the protection will be shifted to target '${newBranchName}'.`
          : ', but no action is required as the default branch is not protected.';
        output.push({
          message: `There are ${branchProtectionRules.length} protected branches${branchMessage}`,
        });
      }
      if (branchProtection) {
        const { id } = branchProtection;
        await this.updateBranchProtectionRule(id, newBranchName);
        output.push({
          message: `Branch protection rule shifted from the old branch '${currentBranchName}' to '${newBranchName}'.`,
        });
      }
      const pulls = await this.getPulls({
        state: GitHubPullRequestState.Open,
        base: currentBranchName,
      });
      if (pulls.length === 0) {
        output.push({ message: `No open pull requests targeting '${currentBranchName}' to update.` });
      } else {
        output.push({
          message: `There are ${pulls.length} open pull requests targeting '${currentBranchName}' that will be updated to '${newBranchName}'.`,
        });
      }
      for (const pull of pulls) {
        try {
          await this.patchPullRequestBranch(pull.number, newBranchName);
          output.push({
            message: `Pull request #${pull.number} has been updated to target '${newBranchName}' (URL: https://github.com/${this.full_name}/pull/${pull.number}, title: '${pull.title}').`,
          });
        } catch (pullError) {
          // To keep the operation going, failed pulls do not short-circuit the process
          output.push({
            message: `Pull request #${pull.number} could not be updated to target '${newBranchName}. Please inspect https://github.com/${this.full_name}/pull/${pull.number}.`,
          });
          output.push({ error: pullError });
        }
      }
      output.push({
        message: `Setting the default branch of the repo ${this.full_name} to '${newBranchName}'.`,
      });
      await this.setDefaultBranch(newBranchName);
      output.push({ message: `Deleting the branch '${currentBranchName}'.` });
      await this.deleteBranch(currentBranchName);
      output.push({
        message: `The repo's default branch is now '${newBranchName}'. Thank you. You may inspect the repo at https://github.com/${this.full_name}/.`,
      });
    } catch (error) {
      output.push({
        message: `The branch rename to '${newBranchName}' was not completely successful. Please review the error and inspect the repo.`,
      });
      output.push({ error });
    }
    return output;
  }

  async patchPullRequestBranch(number: string, targetBranch: string): Promise<void> {
    await this.organization.requireUpdatesApp('patchPullRequestBranch');
    const operations = this._operations as Operations;
    const options = {
      owner: this.organization.name,
      repo: this.name,
      pull_number: number,
      base: targetBranch,
    };
    await operations.github.requestAsPost(
      this.authorize(AppPurpose.Updates),
      'PATCH /repos/:owner/:repo/pulls/:pull_number',
      options
    );
  }

  async createNewBranch(sha: string, newBranchName: string): Promise<void> {
    await this.organization.requireUpdatesApp('createNewBranch');
    const options = {
      owner: this.organization.name,
      repo: this.name,
      ref: `refs/heads/${newBranchName}`,
      sha,
    };
    const operations = this._operations as Operations;
    await operations.github.requestAsPost(
      this.authorize(AppPurpose.Updates),
      'POST /repos/:owner/:repo/git/refs',
      options
    );
  }

  async updateBranchProtectionRule(id: string, newPattern: string): Promise<void> {
    await this.organization.requireUpdatesApp('updateBranchProtectionRule');
    const operations = this._operations as Operations;
    const mutation = `mutation($branchProtectionRuleId:ID!,$pattern:String!) {
      updateBranchProtectionRule (input:{branchProtectionRuleId:$branchProtectionRuleId,pattern:$pattern}) {
        branchProtectionRule {
          id,
          pattern
        }
      }
    }`;
    try {
      await operations.github.graphql(this.authorize(AppPurpose.Updates), mutation, {
        branchProtectionRuleId: id,
        pattern: newPattern,
      });
    } catch (error) {
      throw error;
    }
  }

  async updateBranchProtectionRule2(
    parameters: GitHubBranchProtectionParameters,
    cacheOptions?: ICacheOptions
  ): Promise<RepositoryBranchAccessProtections> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const github = operations.github;

    Object.assign(parameters, cacheOptions);
    // PUT /repos/{owner}/{repo}/branches/{branch}/protection
    const protections = await github.post(
      this.authorize(AppPurpose.Data),
      'repos.updateBranchProtection',
      parameters
    );
    if (protections.length >= 100) {
      console.warn('This API does not support pagination currently... there may be more items');
    }
    return protections as RepositoryBranchAccessProtections;
  }

  async listBranchProtectionRules(): Promise<IGitHubProtectedBranchConfiguration[]> {
    await this.organization.requireUpdatesApp('listBranchProtectionRules');
    const query = `query($owner: String!, $repo: String!) {
      repository(owner:$owner,name:$repo) {
        branchProtectionRules(first:100) {
          nodes {
            id
            pattern
          }
        }
      }
    }`;
    const operations = this._operations as Operations;
    try {
      const {
        repository: {
          branchProtectionRules: { nodes: branchProtectionRules },
        },
      } = await operations.github.graphql(this.authorize(AppPurpose.Updates), query, {
        owner: this.organization.name,
        repo: this.name,
      });
      return branchProtectionRules as IGitHubProtectedBranchConfiguration[];
    } catch (error) {
      throw error;
    }
  }

  async getBranchProtectionDetails(targetBranch) {
    const operations = this._operations as Operations;
    const { rest } = operations.github.octokit;
    const github = operations.github;
    const requirements = operations.github.createRequirementsForFunction(
      this.authorize(AppPurpose.Data),
      rest.repos.getBranchProtection,
      'repos.getBranchProtection'
    );
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      branch: targetBranch,
    };
    try {
      const bpData = await github.callWithRequirements(requirements, parameters);
      return bpData as RepositoryBranchAccessProtections;
    } catch (err) {
      throw err;
    }
  }

  async getRepoRulesets() {
    const operations = this._operations as Operations;
    const { rest } = operations.github.octokit;
    const github = operations.github;
    const requirements = operations.github.createRequirementsForFunction(
      this.authorize(AppPurpose.Data),
      rest.repos.getRepoRulesets,
      'repos.getRepoRulesets'
    );
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    try {
      const ruleData = await github.callWithRequirements(requirements, parameters);
      return ruleData as RepositoryRuleset[];
    } catch (err) {
      throw err;
    }
  }

  async getRepoRulesetDetails(ruleset_id: number) {
    const operations = this._operations as Operations;
    const { rest } = operations.github.octokit;
    const github = operations.github;
    const requirements = operations.github.createRequirementsForFunction(
      this.authorize(AppPurpose.Data),
      rest.repos.getRepoRuleset,
      'repos.getRepoRuleset'
    );
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      ruleset_id,
    };
    try {
      const ruleData = await github.callWithRequirements(requirements, parameters);
      return ruleData as RepositoryRulesetDefinition;
    } catch (err) {
      throw err;
    }
  }

  async getArchivedAt(): Promise<Date> {
    const query = `query($owner: String!, $repo: String!) {
      repository(owner:$owner,name:$repo) {
        id,
        archivedAt
      }
    }`;
    const operations = this._operations as Operations;
    try {
      const { repository } = await operations.github.graphql(this.authorize(AppPurpose.Data), query, {
        owner: this.organization.name,
        repo: this.name,
      });
      if (repository?.archivedAt) {
        return new Date(repository.archivedAt);
      }
    } catch (error) {
      throw error;
    }
  }

  async getProtectedBranchAccessRestrictions(
    branchName: string,
    cacheOptions?: ICacheOptions
  ): Promise<RepositoryBranchAccessProtections> {
    // NOTE: GitHub has a "100-item limit" currently. This is an object response and not
    // technically paginated.
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const github = operations.github;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      branch: branchName,
    };
    if (!cacheOptions.maxAgeSeconds) {
      //cacheOptions.maxAgeSeconds = operations.defaults.orgRepoCollaboratorStaleSeconds;
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      //cacheOptions.backgroundRefresh = true;
    }
    Object.assign(parameters, cacheOptions);
    const { rest } = github.octokit;
    const requirements = github.createRequirementsForFunction(
      this.authorize(AppPurpose.Data),
      rest.repos.getBranchProtection,
      'repos.getBranchProtection'
    );
    try {
      const protections = await github.callWithRequirements(requirements, parameters);
      return protections as RepositoryBranchAccessProtections;
    } catch (err) {
      throw new Error(
        `Error getting branch protection for ${this.organization.name}/${this.name}#${branchName}`
      );
    }
  }

  async getAdminProtectedBranchAccessRestrictions(
    branchName: string,
    cacheOptions?: ICacheOptions
  ): Promise<RepositoryBranchAccessProtections> {
    // NOTE: GitHub has a "100-item limit" currently. This is an object response and not
    // technically paginated.
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const github = operations.github;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      branch: branchName,
    };
    Object.assign(parameters, cacheOptions);
    // GET /repos/{owner}/{repo}/branches/{branch}/protection/enforce_admins
    const { rest } = github.octokit;
    const protections = await github.callWithRequirements(
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Data),
        rest.repos.getAdminBranchProtection,
        'repos.getAdminBranchProtection'
      ),
      parameters,
      cacheOptions
    );
    return protections as RepositoryBranchAccessProtections;
  }

  async setDefaultBranch(defaultBranchName: string): Promise<void> {
    await this.organization.requireUpdatesApp('setDefaultBranch');
    const options = {
      owner: this.organization.name,
      repo: this.name,
      name: this.name,
      default_branch: defaultBranchName,
    };
    const operations = this._operations as Operations;
    await operations.github.requestAsPost(
      this.authorize(AppPurpose.Updates),
      'PATCH /repos/:owner/:repo',
      options
    );
  }

  async deleteBranch(branchName: string): Promise<void> {
    await this.organization.requireUpdatesApp('deleteBranch');
    const options = {
      owner: this.organization.name,
      repo: this.name,
      ref: `heads/${branchName}`,
    };
    const operations = this._operations as Operations;
    await operations.github.requestAsPost(
      this.authorize(AppPurpose.Updates),
      'DELETE /repos/:owner/:repo/git/refs/:ref',
      options
    );
  }

  async listDeployKeys(options?: ICacheOptions): Promise<any> {
    options = options || {};
    const operations = this._operations as Operations;
    const { github } = operations;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoDetailsStaleSeconds,
        options
      ),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const { rest } = github.octokit;
    return await github.callWithRequirements(
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Data),
        rest.repos.listDeployKeys,
        'repos.listDeployKeys'
      ),
      parameters,
      cacheOptions
    );
  }

  async getPages(options?: ICacheOptions): Promise<GitHubPagesResponse> {
    options = options || {};
    const operations = this._operations as Operations;
    const { github } = operations;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoDetailsStaleSeconds,
        options
      ),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    try {
      const { rest } = github.octokit;
      return await github.callWithRequirements(
        github.createRequirementsForFunction(
          this.authorize(AppPurpose.Data),
          rest.repos.getPages,
          'repos.getPages'
        ),
        parameters,
        cacheOptions
      );
    } catch (error) {
      const notFound = error.status && error.status == /* loose */ 404;
      error = wrapError(
        error,
        notFound
          ? 'The repo is not configured for pages.'
          : 'Could not get details about the repo pages configuration.',
        notFound
      );
      if (notFound) {
        error.status = 404;
      }
      throw error;
    }
  }

  async updatePullRequest(pullNumber: number, update: any): Promise<void> {
    const operations = this._operations as Operations;
    const parameters = Object.assign(
      {
        owner: this.organization.name,
        repo: this.name,
        pull_number: pullNumber,
      },
      update
    );
    await operations.github.post(this.authorize(AppPurpose.Operations), 'pulls.update', parameters);
  }

  async checkCollaborator(username: string, cacheOptions?: ICacheOptions): Promise<boolean> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      username,

      allowEmptyResponse: true,
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoTeamsStaleSeconds
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    try {
      const ok = await operations.github.post(
        this.authorize(AppPurpose.Data),
        'repos.checkCollaborator',
        parameters
      );
      return true;
    } catch (error) {
      if (error && error.status == /* loose */ 404) {
        return false;
      }
      throw wrapError(
        error,
        `Could not verify the collaborator level for user ${username} in the repo ${this.organization.name}/${this.name}`
      );
    }
  }

  async isUserPermissionFromTeam(login: string, permission: any) {
    const teamPermissions = await this.getTeamPermissions();
    for (let i = 0; i < teamPermissions.length; i++) {
      try {
        const teamPermission = teamPermissions[i];
        if (teamPermission.permission === permission) {
          if (await teamPermission.team.isMember(login)) {
            return true;
          }
        }
      } catch (ignore) {
        /* ignore */
      }
    }
    return false;
  }

  async getCollaborator(username: string, cacheOptions?: ICacheOptions): Promise<RepositoryPermission> {
    // This call is used in customer-facing sites by permissions middleware
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const github = operations.github;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      username: username,
    };
    if (!cacheOptions.maxAgeSeconds) {
      //cacheOptions.maxAgeSeconds = operations.defaults.orgRepoCollaboratorStaleSeconds;
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      //cacheOptions.backgroundRefresh = true;
    }
    Object.assign(parameters, cacheOptions);
    const { rest } = github.octokit;
    const userPermissionLevel = await github.callWithRequirements(
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.CustomerFacing),
        rest.repos.getCollaboratorPermissionLevel,
        'repos.getCollaboratorPermissionLevel'
      ),
      parameters
    );
    return new RepositoryPermission(userPermissionLevel);
  }

  async listContributors(cacheOptions?: IListContributorsOptions): Promise<any[]> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const github = operations.github;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      per_page: getPageSize(operations),
      anon: cacheOptions.anon || false,
    };
    delete cacheOptions.anon;
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoCollaboratorsStaleSeconds
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const { rest } = github.octokit;
    const contributors = await github.collections.collectAllPagesWithRequirements<any, any>(
      'repoListContributors',
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Data),
        rest.repos.listContributors,
        'repos.listContributors'
      ),
      parameters,
      cacheOptions,
      contributorsDetailsToCopy
    );
    // const contributors = common.createInstances<Collaborator>(this, collaboratorPermissionFromEntity, contributorsEntities);
    return contributors;
  }

  async getCollaborators(cacheOptions?: IGetCollaboratorsOptions): Promise<Collaborator[]> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const doNotProjectEntities = (cacheOptions as any).doNotProjectEntities || false;
    delete (cacheOptions as any).doNotProjectEntities;
    const github = operations.github;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      per_page: getPageSize(operations),
      affiliation: cacheOptions.affiliation || GitHubCollaboratorAffiliationQuery.All,
    };
    delete cacheOptions.affiliation;
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoCollaboratorsStaleSeconds
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const { rest } = github.octokit;
    const memberDetailsToCopy = Collaborator.PrimaryProperties;
    const collaboratorEntities = await github.collections.collectAllPagesWithRequirements<any, any>(
      'repoCollaborators',
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Data),
        rest.repos.listCollaborators,
        'repos.listCollaborators'
      ),
      parameters,
      cacheOptions,
      memberDetailsToCopy
    );
    if (doNotProjectEntities) {
      return collaboratorEntities;
    }
    const collaborators = common.createInstances<Collaborator>(
      this,
      collaboratorPermissionFromEntity,
      collaboratorEntities
    );
    if ((collaboratorEntities as any)?.cost) {
      (collaborators as any).cost = (collaboratorEntities as any).cost;
    }
    if ((collaboratorEntities as any)?.headers) {
      (collaborators as any).headers = (collaboratorEntities as any).headers;
    }
    return collaborators;
  }

  async listCollaboratorInvitations(cacheOptions?: IPagedCacheOptions): Promise<RepositoryInvitation[]> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const github = operations.github;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      per_page: getPageSize(operations),
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoCollaboratorsStaleSeconds
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const { rest } = github.octokit;
    const invitationEntities = await github.collections.collectAllPagesWithRequirements<any, any>(
      'repoInvitations',
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Data),
        rest.repos.listInvitations,
        'repos.listInvitations'
      ),
      parameters,
      cacheOptions,
      repoInviteDetailsToCopy
    );
    const invitations = common.createInstances<RepositoryInvitation>(
      this,
      invitationFromEntity,
      invitationEntities
    );
    if ((invitationEntities as any)?.cost) {
      (invitations as any).cost = (invitationEntities as any).cost;
    }
    if ((invitationEntities as any)?.headers) {
      (invitations as any).headers = (invitationEntities as any).headers;
    }
    return invitations;
  }

  async addCollaborator(
    username: string,
    permission: GitHubRepositoryPermission
  ): Promise<IGitHubCollaboratorInvitation> {
    // BREAKING CHANGE in the GitHub API: as of August 2017, this is "inviteCollaborator', it does not automatically add
    const operations = this._operations as Operations;
    const github = operations.github;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      username: username,
      permission: permission,
    };
    // CONSIDER: If status code 404 on return, the username does not exist on GitHub as entered
    const response = await github.post(
      this.authorize(AppPurpose.Operations),
      'repos.addCollaborator',
      parameters
    );
    return response as IGitHubCollaboratorInvitation;
  }

  async acceptCollaborationInvite(invitationId: string, options: IAlternateTokenOption): Promise<any> {
    // This could go in Account _or_ here in Repository
    if (!options || !options.alternateToken) {
      throw new Error('acceptCollaborationInvite requires options.alternateToken');
    }
    const alternateTokenHeader = `token ${options.alternateToken}`;
    const parameters = {
      invitation_id: invitationId,
    };
    const operations = this._operations as Operations;
    return operations.github.post(
      alternateTokenHeader,
      'repos.acceptInvitationForAuthenticatedUser',
      parameters
    );
  }

  removeCollaborator(username: string): Promise<any> {
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      username: username,
    };
    const operations = this._operations as Operations;
    return operations.github.post(
      this.authorize(AppPurpose.Operations),
      'repos.removeCollaborator',
      parameters
    );
  }

  delete(): Promise<void> {
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    const operations = this._operations as Operations;
    return operations.github.post(this.authorize(AppPurpose.Operations), 'repos.delete', parameters);
  }

  createFile(
    path: string,
    base64Content: string,
    commitMessage: string,
    options?: CreateFileOptions
  ): Promise<any> {
    options = options || {};
    const operations = this._operations as Operations;
    const alternateToken = options?.alternateToken;
    if (alternateToken) {
      delete options.alternateToken;
    }
    const parameters: CreateFileParameters = Object.assign(
      {
        owner: this.organization.name,
        repo: this.name,
        path,
        message: commitMessage,
        content: base64Content,
      },
      options
    );
    if (options?.sha) {
      parameters.sha = options.sha;
    }
    if (options?.branch) {
      parameters.branch = options.branch;
    }
    if (options?.committer) {
      parameters.committer = options.committer;
    }
    const alternateHeader = alternateToken ? `token ${alternateToken}` : null;
    return operations.github.post(
      alternateHeader || this.authorize(AppPurpose.Operations),
      'repos.createOrUpdateFileContents',
      parameters
    );
  }

  getFile(
    path: string,
    options?: GitHubGetFileOptions,
    cacheOptions?: ICacheOptions
  ): Promise<GitHubFileContents> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const parameters: IGitHubGetFileParameters = Object.assign(
      {
        owner: this.organization.name,
        repo: this.name,
        path,
      },
      options
    );
    if (options && options.ref) {
      parameters.ref = options.ref;
    }
    // const alternateHeader = options.alternateToken ? `token ${options.alternateToken}` : null;
    const { github } = operations;
    const { rest } = github.octokit;
    return operations.github.callWithRequirements(
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Operations),
        rest.repos.getContent,
        'repos.getContent'
      ),
      parameters as any,
      cacheOptions
    );
  }

  async getFiles(
    path: string,
    options?: GitHubGetFileOptions,
    cacheOptions?: ICacheOptions
  ): Promise<GitHubFileContents[]> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const parameters: IGitHubGetFileParameters = Object.assign(
      {
        owner: this.organization.name,
        repo: this.name,
        path,
      },
      options
    );
    if (options.ref) {
      parameters.ref = options.ref;
    }
    // const alternateHeader = options.alternateToken ? `token ${options.alternateToken}` : null;
    const { github } = operations;
    const { rest } = github.octokit;
    try {
      const getContentResponse = await operations.github.callWithRequirements(
        github.createRequirementsForFunction(
          this.authorize(AppPurpose.Security),
          rest.repos.getContent,
          'repos.getContent'
        ),
        parameters as any,
        cacheOptions
      );
      if (Array.isArray(getContentResponse)) {
        return Array.from(getContentResponse);
      }
      return getContentResponse;
    } catch (error) {
      if (!ErrorHelper.IsNotFound(error)) {
        console.dir(error);
        console.warn(error);
        throw error;
      }
      return [];
    }
  }

  async setTeamPermission(teamId: number, newPermission: GitHubRepositoryPermission): Promise<any> {
    const operations = this._operations as Operations;
    const team = this.organization.team(teamId);
    // CONSIDER: note the performance penalty on the slug resolution; the alternate path has not been working for GitHub Apps
    await team.getDetails();
    const options = {
      org: this.organization.name,
      team_slug: team.slug,
      owner: this.organization.name,
      repo: this.name,
      permission: newPermission,
    };
    // alternate version of: 'teams.octokit.teams.addOrUpdateRepoPermissionsInOrg': 'PUT /organizations/:org_id/team/:team_id/repos/:owner/:repo'
    const result = await operations.github.post(
      this.authorize(AppPurpose.Operations),
      'teams.addOrUpdateRepoPermissionsInOrg',
      options
    );
    return result;
  }

  removeTeamPermission(teamId: number): Promise<any> {
    const operations = this._operations as Operations;
    const options = {
      org_id: this.organization.id.toString(),
      team_id: teamId,
      owner: this.organization.name,
      repo: this.name,
    };
    // alternate version of: 'teams.removeRepoInOrg'
    return operations.github.requestAsPost(
      this.authorize(AppPurpose.Operations),
      'DELETE /organizations/:org_id/team/:team_id/repos/:owner/:repo',
      options
    );
  }

  async getWebhooks(options?: ICacheOptions): Promise<any> {
    options = options || {};
    const operations = this._operations as Operations;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoWebhooksStaleSeconds,
        options
      ),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const { github } = operations;
    const { rest } = github.octokit;
    return github.callWithRequirements(
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Data),
        rest.repos.listWebhooks,
        'repos.listWebhooks'
      ),
      parameters,
      cacheOptions
    );
  }

  deleteWebhook(webhookId: string): Promise<any> {
    const operations = this._operations as Operations;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      id: webhookId,
    };
    return operations.github.post(this.authorize(AppPurpose.Operations), 'repos.deleteWebhook', parameters);
  }

  createWebhook(options: ICreateWebhookOptions): Promise<any> {
    const operations = this._operations as Operations;
    delete options['owner'];
    delete options['repo'];
    const parameters = Object.assign(
      {
        owner: this.organization.name,
        repo: this.name,
      },
      options
    );
    // Smart defaults: create an active JSON web hook to the 'url' option
    if (!options.name) {
      parameters.name = 'web';
    }
    if (options.active === undefined) {
      parameters.active = true;
    }
    if (options.url && !options.config) {
      delete parameters.url;
      parameters.config = {
        url: options.url,
        content_type: 'json',
      };
    }
    return operations.github.post(this.authorize(AppPurpose.Operations), 'repos.createWebhook', parameters);
  }

  async editPublicPrivate(options): Promise<void> {
    options = options || {};
    const operations = this._operations as Operations;
    if (options.private !== true && options.private !== false) {
      throw new Error('editPublicPrivate.options requires private to be set to true or false');
    }
    const parameters = Object.assign(
      {
        owner: this.organization.name,
        repo: this.name,
      },
      {
        private: options.private,
      }
    );
    return operations.github.post(this.authorize(AppPurpose.Operations), 'repos.update', parameters);
  }

  async archive(): Promise<void> {
    const operations = this._operations as Operations;
    const parameters = Object.assign(
      {
        owner: this.organization.name,
        repo: this.name,
      },
      {
        archived: true,
      }
    );
    return operations.github.post(this.authorize(AppPurpose.Operations), 'repos.update', parameters);
  }

  async unarchive(): Promise<UnarchiveResponse> {
    const operations = this._operations as Operations;
    const nodeId = await this.getGraphQlNodeId();
    const mutation = `
      mutation ($repositoryId:ID!) {
        unarchiveRepository(input:{repositoryId:$repositoryId}) {
          repository {
            isArchived
          }
        }
      }
    `;
    try {
      return (await operations.github.graphql(this.authorize(AppPurpose.Operations), mutation, {
        repositoryId: nodeId,
      })) as UnarchiveResponse;
    } catch (error) {
      throw error;
    }
  }

  async update(patch?: any): Promise<void> {
    const operations = this._operations as Operations;
    const parameters = Object.assign(patch, {
      owner: this.organization.name,
      repo: this.name,
    });
    return operations.github.post(this.authorize(AppPurpose.Operations), 'repos.update', parameters);
  }

  async getTeamPermissions(cacheOptions?: IPagedCacheOptions): Promise<TeamPermission[]> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const doNotProjectEntities = (cacheOptions as any).doNotProjectEntities || false;
    delete (cacheOptions as any).doNotProjectEntities;
    const github = operations.github;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      per_page: getPageSize(operations),
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoTeamsStaleSeconds
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const { rest } = github.octokit;
    const permissionEntities = await github.collections.collectAllPagesWithRequirements<any, any>(
      'repoTeamPermissions',
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Data),
        rest.repos.listTeams,
        'repos.listTeams'
      ),
      parameters,
      cacheOptions,
      teamPermissionsToCopyForRepository
    );
    if (doNotProjectEntities) {
      return permissionEntities;
    }
    const teamPermissions = common.createInstances<TeamPermission>(
      this,
      teamPermissionFromEntity,
      permissionEntities
    );
    return teamPermissions;
  }

  async checkTeamManages(teamId: string, cacheOptions?: ICacheOptions): Promise<boolean> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const parameters = {
      owner: this.organization.name,
      org_id: this.organization.id.toString(),
      repo: this.name,
      team_id: teamId,

      allowEmptyResponse: true,
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoTeamsStaleSeconds
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    try {
      // this is the alternate form of 'teams.checkPermissionsForRepoInOrg'
      await operations.github.requestAsPost(
        this.authorize(AppPurpose.Data),
        'GET /organizations/:org_id/team/:team_id/repos/:owner/:repo',
        parameters
      );
      return true;
    } catch (error) {
      if (error && error.status == /* loose */ 404) {
        return false;
      }
      throw wrapError(
        error,
        `Could not verify the team management permissions of the repo ${this.organization.name}/${this.name} for team ${teamId}`
      );
    }
  }

  async enableSecretScanning(enablePushProtection?: boolean): Promise<boolean> {
    const pushProtectionValue = enablePushProtection !== undefined ? !!enablePushProtection : true;
    const patch = {
      security_and_analysis: {
        secret_scanning: { status: 'enabled' },
        secret_scanning_push_protection: { status: pushProtectionValue ? 'enabled' : 'disabled' },
      },
    };
    try {
      await this.update(patch);
      return true;
    } catch (error) {
      if (error && error.status == /* loose */ 404 && error.message === 'Secret scanning is disabled') {
        return false;
      }
      throw error;
    }
  }

  async getSecretScanningAlerts(cacheOptions?: ICacheOptions): Promise<IGitHubSecretScanningAlert[]> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const parameters = {
      // repo_id: this.id.toString(),
      owner: this.organization.name,
      repo: this.name,
      per_page: 100,
      // state: 'open' | 'resolved'
    };
    // NOTE: not paginating for now
    // if (!cacheOptions.maxAgeSeconds) {
    //   cacheOptions.maxAgeSeconds = operations.defaults.orgRepoTeamsStaleSeconds;
    // }
    // if (cacheOptions.backgroundRefresh === undefined) {
    //   cacheOptions.backgroundRefresh = true;
    // }
    try {
      // using requestAsPost to _not cache_ the secrets for now
      const response = await operations.github.requestAsPost(
        this.authorize(AppPurpose.Data),
        'GET /repos/:owner/:repo/secret-scanning/alerts',
        parameters
      );
      return response as IGitHubSecretScanningAlert[];
    } catch (error) {
      if (
        error &&
        error.status == /* loose */ 404 &&
        error.message === 'Secret scanning is disabled on this repository.'
      ) {
        throw error;
      }
      throw error;
    }
  }

  async checkSecretScanning(cacheOptions?: ICacheOptions): Promise<boolean> {
    // NOTE: this is an experimental API as part of the program public beta, and likely not available
    // to most users. Expect this call to fail.
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const parameters = {
      repo_id: this.id.toString(),
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoTeamsStaleSeconds
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    try {
      await operations.github.requestAsPost(
        this.authorize(AppPurpose.Operations),
        'GET /repositories/:repo_id/secret-scanning',
        parameters
      );
      return true;
    } catch (error) {
      if (error && error.status == /* loose */ 404 && error.message === 'Secret scanning is disabled') {
        return false;
      }
      throw error;
    }
  }

  async getAdministrators(excludeOwners = true, excludeBroadAndSystemTeams = true): Promise<string[]> {
    const operations = this._operations as Operations;
    const owners = await this._organization.getOwners();
    const ownersSet = new Set<string>(owners.map((o) => o.login.toLowerCase()));
    const actualCollaborators = await this.getCollaborators({
      affiliation: GitHubCollaboratorAffiliationQuery.Direct,
    });
    let collaborators = actualCollaborators.filter((c) => c.permissions?.admin === true);
    // No system accounts or owners
    collaborators = collaborators.filter((c) => false === operations.isSystemAccountByUsername(c.login));
    if (excludeOwners) {
      collaborators = collaborators.filter((c) => false === ownersSet.has(c.login.toLowerCase()));
    }
    const users = new Set<string>(collaborators.map((c) => c.login.toLowerCase()));
    const teams = (await this.getTeamPermissions()).filter((tp) => tp.permission === 'admin');
    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      if (
        excludeBroadAndSystemTeams &&
        (team.team.isSystemTeam || team.team.isBroadAccessTeam || team.team.isOpenAccessTeam)
      ) {
        // Do not include broad access teams
        continue;
      }
      const members = await team.team.getMembers();
      for (let j = 0; j < members.length; j++) {
        const tm = members[j];
        const login = tm.login.toLowerCase();
        if (!ownersSet.has(login) && !operations.isSystemAccountByUsername(login)) {
          users.add(login.toLowerCase());
        }
      }
    }
    return Array.from(users.values());
  }

  async getPushers(): Promise<string[]> {
    const operations = this._operations as Operations;
    // duplicated code from getAdministrators
    const owners = await this._organization.getOwners();
    const ownersSet = new Set<string>(owners.map((o) => o.login.toLowerCase()));
    const actualCollaborators = await this.getCollaborators({
      affiliation: GitHubCollaboratorAffiliationQuery.Direct,
    });
    let collaborators = actualCollaborators.filter((c) => c.permissions?.push === true);
    // No system accounts or owners
    collaborators = collaborators.filter((c) => false === operations.isSystemAccountByUsername(c.login));
    collaborators = collaborators.filter((c) => false === ownersSet.has(c.login.toLowerCase()));
    const users = new Set<string>(collaborators.map((c) => c.login.toLowerCase()));
    const teams = (await this.getTeamPermissions()).filter((tp) => tp.permission === 'push');
    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      if (team.team.isSystemTeam || team.team.isBroadAccessTeam) {
        // Do not include broad access teams
        continue;
      }
      const members = await team.team.getMembers();
      for (let j = 0; j < members.length; j++) {
        const tm = members[j];
        const login = tm.login.toLowerCase();
        if (!ownersSet.has(login) && !operations.isSystemAccountByUsername(login)) {
          users.add(login.toLowerCase());
        }
      }
    }
    return Array.from(users.values());
  }

  async getPullers(excludeBroadTeamsAndOwners = true): Promise<string[]> {
    // duplicated code from getAdministrators
    if (!this.private) {
      return [];
    }
    const operations = this._operations as Operations;
    const owners = await this._organization.getOwners();
    const ownersSet = new Set<string>(owners.map((o) => o.login.toLowerCase()));
    const actualCollaborators = await this.getCollaborators({
      affiliation: GitHubCollaboratorAffiliationQuery.Direct,
    });
    let collaborators = actualCollaborators.filter((c) => c.permissions?.pull === true);
    // No system accounts or owners
    collaborators = collaborators.filter((c) => false === operations.isSystemAccountByUsername(c.login));
    if (excludeBroadTeamsAndOwners) {
      collaborators = collaborators.filter((c) => false === ownersSet.has(c.login.toLowerCase()));
    }
    const users = new Set<string>(collaborators.map((c) => c.login.toLowerCase()));
    const teams = (await this.getTeamPermissions()).filter((tp) => tp.permission === 'pull');
    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      if (excludeBroadTeamsAndOwners && (team.team.isSystemTeam || team.team.isBroadAccessTeam)) {
        // Do not include broad access teams
        continue;
      }
      const members = await team.team.getMembers();
      for (let j = 0; j < members.length; j++) {
        const tm = members[j];
        const login = tm.login.toLowerCase();
        if (!ownersSet.has(login) && !operations.isSystemAccountByUsername(login)) {
          users.add(login.toLowerCase());
        }
      }
    }
    return Array.from(users.values());
  }

  async getViews(options?: ICacheOptions): Promise<any> {
    options = options || {};
    const operations = this._operations as Operations;
    const { github } = operations;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoDetailsStaleSeconds,
        options
      ),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    try {
      const { rest } = github.octokit;
      return await github.callWithRequirements(
        github.createRequirementsForFunction(
          this.authorize(AppPurpose.Data),
          rest.repos.getViews,
          'repos.getViews'
        ),
        parameters,
        cacheOptions
      );
    } catch (error) {
      const notFound = error.status && error.status == /* loose */ 404;
      error = wrapError(
        error,
        notFound
          ? 'The repo is not configured for views.'
          : 'Could not get details about the repo views configuration.',
        notFound
      );
      if (notFound) {
        error.status = 404;
      }
      throw error;
    }
  }

  private authorize(purpose: AppPurposeTypes): GetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(this, purpose) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }

  private specificAuthorization(purpose: AppPurposeTypes): GetAuthorizationHeader | string {
    const getSpecificHeader = this._getSpecificAuthorizationHeader.bind(
      this,
      purpose
    ) as GetAuthorizationHeader;
    return getSpecificHeader;
  }

  public static SortByAwesomeness(a: Repository, b: Repository) {
    return b.computeAwesomeness() - a.computeAwesomeness();
  }

  public computeAwesomeness() {
    if (this._awesomeness) {
      return this._awesomeness;
    }
    const repo = this;
    const pushAwesomeness = 1000;
    const pushHalfLife = 42 * Math.E * Math.pow(10, -15);
    const starAwesomeness = (10 + Math.PI) * Math.pow(10, 13);
    const maxValue = 32767;
    if (!repo.pushed_at) {
      return 0;
    }
    const pushTicks = (moment.utc().valueOf() - moment.utc(repo.pushed_at).valueOf()) * 10000;
    const createdTicks = (moment.utc().valueOf() - moment.utc(repo.created_at).valueOf()) * 10000;
    // People power, if you have a high star factor (i.e. stars per day) then you
    // are definitely awesome.
    let awesomeness = (starAwesomeness * repo.stargazers_count) / createdTicks;
    // Make it so a recent contribution pushes you up the stack, but make the effect
    // fade quickly (as determined by the halflife of a push.
    awesomeness += pushAwesomeness * Math.pow(Math.E, -1 * pushHalfLife * pushTicks);
    // Everyone who makes their code open source is a little bit awesome.
    ++awesomeness;
    if (awesomeness > maxValue) {
      awesomeness = maxValue;
    }
    this._awesomeness = awesomeness;
    return this._awesomeness;
  }

  async getIssues(options?: IRepositoryGetIssuesOptions): Promise<RepositoryIssue[]> {
    options = options || {};
    const operations = this._operations as Operations;
    const github = operations.github;
    const parameters = {
      owner: this.organization.name,
      repo: this.name,
      per_page: getPageSize(operations),
      milestone: options.milestone,
      state: options.state,
      assignee: options.assignee,
      creator: options.creator,
      mentioned: options.mentioned,
      labels: options.labels,
      sort: options.sort,
      direction: options.direction,
      since: options.since ? options.since.toISOString() : undefined,
    };
    const cacheOptions: IPagedCacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgRepoTeamsStaleSeconds,
        options
      ),
      backgroundRefresh: options.backgroundRefresh !== undefined ? options.backgroundRefresh : true,
      pageRequestDelay: options.pageRequestDelay,
    };
    const { rest } = github.octokit;
    const issuesAndPullRequests = await github.collections.collectAllPagesWithRequirements<any, any>(
      'repoIssues',
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Data),
        rest.issues.listForRepo,
        'issues.listForRepo'
      ),
      parameters,
      cacheOptions
    );
    const issuesOnly = issuesAndPullRequests.filter((r) => !r.pull_request);
    const issues = common.createInstances<RepositoryIssue>(this, issueFromEntity, issuesOnly);
    return issues;
  }

  // legacy Projects
  // async getProjects(options?: IPagedCacheOptions): Promise<RepositoryProject[]> {
  //   // NOTE: currently only available for the "Onboarding" app
  //   options = options || {};
  //   const operations = this._operations as Operations;
  //   const github = operations.github;
  //   const parameters = {
  //     owner: this.organization.name,
  //     repo: this.name,
  //     per_page: getPageSize(operations),
  //     // supported but not in the type now: state: options.state,
  //   };
  //   augmentInertiaPreview(parameters);
  //   const cacheOptions: IPagedCacheOptions = {
  //     maxAgeSeconds: getMaxAgeSeconds(operations as Operations, CacheDefault.orgRepoTeamsStaleSeconds, options),
  //     backgroundRefresh: options.backgroundRefresh !== undefined ? options.backgroundRefresh : true,
  //     pageRequestDelay: options.pageRequestDelay,
  //   };
  //   const { rest } = github.octokit;
  //   const projectsRaw = await github.collections.collectAllPagesWithRequirements<any, any>(
  //     'repoProjects',
  //     github.createRequirementsForFunction(
  //       this.authorize(AppPurpose.Data),
  //       rest.projects.listForRepo,
  //       'projects.listForRepo'
  //     ),
  //     parameters,
  //     cacheOptions
  //   );
  //   const projects = common.createInstances<RepositoryProject>(this, projectFromEntity, projectsRaw);
  //   return projects;
  // }

  // async createProject(projectName: string, options?: GitHubNewProjectOptions): Promise<RepositoryProject> {
  //   options = options || {};
  //   const operations = this._operations as Operations;
  //   delete (options as any).owner;
  //   delete (options as any).repo;
  //   delete (options as any).name;
  //   const orgName = this.organization.name;
  //   const repositoryName = this.name;
  //   const parameters = Object.assign(
  //     {
  //       owner: orgName,
  //       repo: repositoryName,
  //       name: projectName,
  //     },
  //     options
  //   );
  //   augmentInertiaPreview(parameters);
  //   const details = await operations.github.post(
  //     this.specificAuthorization(AppPurpose.Operations),
  //     'projects.createForRepo',
  //     parameters
  //   );
  //   const newProject = new RepositoryProject(
  //     this,
  //     details.id,
  //     operations,
  //     this._getAuthorizationHeader,
  //     this._getSpecificAuthorizationHeader,
  //     details
  //   );
  //   return newProject;
  // }

  pullRequest(pullRequestNumber: number, optionalEntity?: any): RepositoryPullRequest {
    const pr = new RepositoryPullRequest(
      this,
      pullRequestNumber,
      this._operations,
      this._getAuthorizationHeader,
      optionalEntity
    );
    return pr;
  }

  // project(projectId: number, optionalEntity?: any): RepositoryProject {
  //   const project = new RepositoryProject(
  //     this,
  //     projectId,
  //     this._operations,
  //     this._getAuthorizationHeader,
  //     this._getSpecificAuthorizationHeader,
  //     optionalEntity
  //   );
  //   return project;
  // }

  issue(issueNumber: number, optionalEntity?: any): RepositoryIssue {
    const issue = new RepositoryIssue(
      this,
      issueNumber,
      this._operations,
      this._getAuthorizationHeader,
      optionalEntity
    );
    return issue;
  }

  async createIssue(
    title: string,
    body: string,
    options?: NewIssueOptions,
    overriddenPurpose?: AppPurposeTypes
  ): Promise<RepositoryIssue> {
    const operations = this._operations as Operations;
    options = options || {};
    delete (options as any).owner;
    delete (options as any).repo;
    delete (options as any).title;
    delete (options as any).body;
    const parameters = Object.assign(
      {
        owner: this.organization.name,
        repo: this.name,
        title,
        body,
      },
      options
    );
    const purpose = overriddenPurpose || AppPurpose.Operations; // Operations has issue write permissions
    const details = await operations.github.post(
      overriddenPurpose ? this.specificAuthorization(purpose) : this.authorize(purpose),
      'issues.create',
      parameters
    );
    const issueNumber = details.number as number;
    const issue = new RepositoryIssue(
      this,
      issueNumber,
      this._operations,
      this._getAuthorizationHeader,
      details
    );
    return issue;
  }

  async getCommitComment(commentId: string): Promise<any> {
    const operations = this._operations as Operations;
    const parameters = Object.assign({
      owner: this.organization.name,
      repo: this.name,
      comment_id: commentId,
    });
    const comment = await operations.github.post(
      this.authorize(AppPurpose.Operations),
      'repos.getCommitComment',
      parameters
    );
    return comment;
  }

  async isCommitCommentDeleted(commentId: string) {
    try {
      await this.getCommitComment(commentId);
      return false;
    } catch (error) {
      if (ErrorHelper.IsNotFound(error)) {
        return true;
      }
      throw error;
    }
  }
}

// function projectFromEntity(entity) {
//   // 'this' is bound for this function to be a private method
//   const operations = this._operations;
//   const permission = new RepositoryProject(
//     this,
//     entity.id,
//     operations,
//     this._getAuthorizationHeader,
//     this._getSpecificAuthorizationHeader,
//     entity
//   );
//   return permission;
// }

function issueFromEntity(entity) {
  // 'this' is bound for this function to be a private method
  const operations = this._operations;
  const permission = new RepositoryIssue(
    this,
    entity.number,
    operations,
    this._getAuthorizationHeader,
    entity
  );
  return permission;
}

function teamPermissionFromEntity(entity) {
  // 'this' is bound for this function to be a private method
  const operations = this._operations;
  const permission = new TeamPermission(this.organization, entity, operations);
  return permission;
}

function collaboratorPermissionFromEntity(entity) {
  // 'this' is bound for this function to be a private method
  const permission = new Collaborator(entity);
  return permission;
}

function invitationFromEntity(entity) {
  // 'this' is bound for this function to be a private method
  const invitation = new RepositoryInvitation(this, entity);
  return invitation;
}

const teamPermissionsToCopyForRepository = [
  'name',
  'id',
  'slug',
  'description',
  // 'members_count',
  // 'repos_count',
  'privacy',
  // 'notification_setting',
  'permission', // custom role name at times
  'permissions', // array of booleans for admin, maintain, push, triage, pull
  'parent', // large object for a parent team, if present
];

const contributorsDetailsToCopy = [...Collaborator.PrimaryProperties, 'contributions'];

const repoInviteDetailsToCopy = RepositoryInvitation.PrimaryProperties;

const branchDetailsToCopy = ['name', 'commit', 'protected'];

const pullDetailsToCopy = [
  'id',
  'number',
  'state',
  'locked',
  'title',
  // user
  'body',
  // labels
  // milestone
  // active_lock_reason
  'created_at',
  'updated_at',
  'closed_at',
  'merged_at',
  'merge_commit_sha',
  'assignee', // << NOTE: this was deprecated in 2020 (? not sure on date)
  'assignees',
  // requested_reviewers
  // requested_teams
  'head', // PERF: large user of list storage
  'base', // PERF: large user of list storage
  'author_association',
  'draft',
];
