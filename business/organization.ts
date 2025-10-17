//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import _ from 'lodash';

import * as common from './common.js';
import { OrganizationMember } from './organizationMember.js';
import { Team } from './team.js';
import { Repository } from './repository.js';

import { wrapError } from '../lib/utils.js';
import { StripGitHubEntity } from '../lib/github/restApi.js';
import { GitHubResponseType } from '../lib/github/endpointEntities.js';
import { AppPurpose, AppPurposeTypes } from '../lib/github/appPurposes.js';
import {
  OrganizationFeature,
  OrganizationSetting,
  SystemTeam,
} from './entities/organizationSettings/organizationSetting.js';
import { createOrganizationSudoInstance, IOrganizationSudo } from './features/index.js';
import { CacheDefault, getMaxAgeSeconds, getPageSize } from './operations/core.js';
import {
  GitHubAuditLogEntry,
  GitHubOrganizationInvite,
  GitHubRepositoryVisibility,
  IAccountBasics,
  IAddOrganizationMembershipOptions,
  AuthorizationHeaderValue,
  ICacheOptions,
  ICacheOptionsWithPurpose,
  ICorporateLink,
  ICreateRepositoryResult,
  type GetAuthorizationHeader,
  IGetAuditLogOptions,
  GetOrganizationMembersOptions,
  IGitHubAccountDetails,
  IOrganizationMemberPair,
  IOrganizationMembership,
  IPagedCacheOptions,
  type PurposefulGetAuthorizationHeader,
  IReposError,
  IReposRestRedisCacheCost,
  NoCacheNoBackground,
  OrganizationMembershipRoleQuery,
  OrganizationMembershipTwoFactorFilter,
  GitHubRepositoryDetails,
  OrganizationMembershipState,
  OrganizationMembershipRole,
} from '../interfaces/index.js';
import { CreateError, ErrorHelper } from '../lib/transitional.js';
import { jsonError } from '../middleware/index.js';
import getCompanySpecificDeployment from '../middleware/companySpecificDeployment.js';
import { ConfigGitHubTemplates } from '../config/github.templates.types.js';
import { GitHubTokenManager } from '../lib/github/tokenManager.js';
import { OrganizationProjects } from './projects.js';
import { OrganizationDomains } from './domains.js';
import { OrganizationCopilot } from './organizationCopilot.js';
import { OrganizationProperties } from './organizationProperties.js';
import { Operations } from './operations/index.js';
import { RepositoryPrimaryProperties } from './primaryProperties.js';
import { Collaborator } from './collaborator.js';
import { OrganizationSingleSignOn } from './organizationSso.js';

type GetDetailsOptions = {
  lookupById?: boolean;
};

interface IGetMembersParameters {
  org: string;
  per_page: number;
  filter?: string;
  role?: string;
}

interface ICheckPublicMembershipParameters {
  username: string;
  org: string;
  allowEmptyResponse?: boolean;
}

interface IRedirectError extends IReposError {
  status?: number;
  slug?: string;
  team?: Team;
}

export interface IAdministratorBasics {
  id: number;
  login: string;
  sudo: boolean;
  owner: boolean;
}

export interface IGitHubOrganizationPlanResponse {
  filled_seats: number;
  name: string;
  private_repos: number;
  seats: number;
  space: number;
}

export type GitHubOrganizationResponse = {
  archived_at?: string;
  avatar_url?: string;
  billing_email?: string;
  blog?: string;
  collaborators: number;
  company?: string;
  cost?: IReposRestRedisCacheCost;
  created_at: string;
  default_repository_permission: string;
  description: string;
  disk_usage: number;
  email: string;
  followers: number;
  following: number;
  has_organization_projects: boolean;
  has_repository_projects: boolean;
  headers?: unknown;
  html_url: string;
  id: number;
  is_verified: boolean;
  location: string;
  login: string;
  members_can_create_repositories: boolean;
  name: string;
  node_id: string;
  owned_private_repos: number;
  plan: IGitHubOrganizationPlanResponse;
  private_gists: number;
  public_gists: number;
  total_private_repos: number;
  two_factor_requirement_enabled: boolean;
  type: string;
  updated_at: string;
  url: string;
};

// the only fields we want in this type based on GitHubOrganizationResponse are avatar_url, blog, company, created_at, description, email, id, location, login, name, updated_at
export type GitHubOrganizationResponseSanitized = Pick<
  GitHubOrganizationResponse,
  | 'avatar_url'
  | 'blog'
  | 'company'
  | 'created_at'
  | 'description'
  | 'email'
  | 'id'
  | 'location'
  | 'login'
  | 'name'
  | 'updated_at'
>;

const sanitizedFields = [
  'avatar_url',
  'blog',
  'company',
  'created_at',
  'description',
  'email',
  'id',
  'location',
  'login',
  'name',
  'updated_at',
];

export function getOrganizationDetailsSanitized(
  details: GitHubOrganizationResponse
): GitHubOrganizationResponseSanitized {
  if (details) {
    const sanitized = {} as GitHubOrganizationResponseSanitized;
    for (const field of sanitizedFields) {
      if (details[field]) {
        sanitized[field] = details[field];
      }
    }
    return sanitized;
  }
}

export type RunnerData = {
  busy: boolean;
  id: number;
  name: string;
  os: string;
  status: string;
  labels: GitHubRunnerLabel[];
};

export type GitHubRunnerLabel = {
  id: number;
  name: string;
  type: string;
};

export interface IGitHubOrganizationRunners {
  total_count: number;
  runners: RunnerData[];
}
type CreateRepositoryEntityById = Partial<GitHubRepositoryDetails> & Pick<GitHubRepositoryDetails, 'id'>;
type CreateRepositoryEntityByName = Partial<GitHubRepositoryDetails> & Pick<GitHubRepositoryDetails, 'name'>;
type CreateRepositoryEntity = CreateRepositoryEntityById | CreateRepositoryEntityByName;

export class Organization {
  private _name: string;
  private _baseUrl: string;
  private _nativeUrl: string;
  private _nativeManagementUrl: string;

  private _operations: Operations;
  private _getAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _usesGitHubApp: boolean;
  private _settings: OrganizationSetting;

  private _entity: GitHubOrganizationResponse;

  private _organizationSudo: IOrganizationSudo;

  private _projects: OrganizationProjects;
  private _domains: OrganizationDomains;

  private _copilot: OrganizationCopilot;
  private _sso: OrganizationSingleSignOn;
  private _customProperties: OrganizationProperties;

  id: number;
  uncontrolled: boolean;

  constructor(
    operations: Operations,
    name: string,
    settings: OrganizationSetting,
    getAuthorizationHeader: PurposefulGetAuthorizationHeader,
    getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader,
    public hasDynamicSettings: boolean
  ) {
    this._name = settings.organizationName || name;
    this._operations = operations;
    this._settings = settings;
    this._usesGitHubApp = settings?.installations?.length > 0 || false;
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._getSpecificAuthorizationHeader = getSpecificAuthorizationHeader;
    if (settings && settings.organizationId) {
      this.id = Number(settings.organizationId);
    }
    this._baseUrl = `${operations.baseUrl}${this.name}/`;
    this._nativeUrl = `${operations.nativeUrl}${this.name}/`;
    this._nativeManagementUrl = `${operations.nativeManagementUrl}${this.name}/`;
    const withProviders = operations as Operations;
    if (withProviders?.providers) {
      this._organizationSudo = createOrganizationSudoInstance(withProviders.providers, this);
    }
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  get nativeUrl(): string {
    return this._nativeUrl;
  }

  get nativeManagementUrl(): string {
    return this._nativeManagementUrl;
  }

  get absoluteBaseUrl(): string {
    return this._operations.absoluteBaseUrl + this._operations.organizationsDeliminator + this.name + '/';
  }

  get name(): string {
    return this._name;
  }

  get active(): boolean {
    return this._settings ? this._settings.active : false;
  }

  get usesApp(): boolean {
    return this._usesGitHubApp;
  }

  get operations() {
    return this._operations;
  }

  asClientJson() {
    // TEMP: TEMP: TEMP: not long-term as currently designed
    const values = {
      active: this.active,
      createRepositoriesOnGitHub: this.createRepositoriesOnGitHub,
      description: this.description,
      externalMembersPermitted: this.externalMembersPermitted,
      id: this.id,
      locked: this.locked,
      appOnly: this.isAppOnly,
      name: this.name,
      priority: this.priority,
      privateEngineering: this.privateEngineering,
      management: this.getManagementApproach(),
      configuredOrganizationRepositoryTypes: this.getSupportedNewRepositoryVisibilitiesByPriority(),
    };

    const companySpecificDeployment = getCompanySpecificDeployment();
    if (companySpecificDeployment?.features?.augmentApiMetadata) {
      const providers = this._operations.providers;
      return companySpecificDeployment.features.augmentApiMetadata.augmentOrganizationClientJson(
        providers,
        this,
        values
      );
    }

    return values as object;
  }

  getManagementApproach() {
    // TEMP: not long-term as designed
    let management = null;
    if (this.hasDynamicSettings) {
      const val =
        (this.getDynamicSettings().getProperty('management') as string) ||
        (this.getDynamicSettings().getProperty('governance') as string);
      management = val;
    }
    return management;
  }

  getEntity() {
    return this._entity;
  }

  async getGraphQlNodeId() {
    if (!this.getEntity()?.node_id) {
      await this.getDetails();
    }
    const { node_id: nodeId } = this.getEntity();
    return nodeId;
  }

  get projects() {
    if (!this._projects) {
      this._projects = new OrganizationProjects(
        this,
        this._operations,
        this._getAuthorizationHeader,
        this._getSpecificAuthorizationHeader
      );
    }
    return this._projects;
  }

  get copilot() {
    if (!this._copilot) {
      this._copilot = new OrganizationCopilot(
        this,
        this._getSpecificAuthorizationHeader.bind(this),
        this._operations
      );
    }
    return this._copilot;
  }

  get singleSignOn() {
    if (!this._sso) {
      this._sso = new OrganizationSingleSignOn(
        this,
        this._getAuthorizationHeader.bind(this),
        this._getSpecificAuthorizationHeader.bind(this),
        this._operations
      );
    }
    return this._sso;
  }

  get customProperties() {
    if (!this._customProperties) {
      this._customProperties = new OrganizationProperties(
        this,
        this._getSpecificAuthorizationHeader.bind(this),
        this._operations
      );
    }
    return this._customProperties;
  }

  get domains() {
    if (!this._domains) {
      this._domains = new OrganizationDomains(
        this,
        this._operations,
        this._getAuthorizationHeader,
        this._getSpecificAuthorizationHeader
      );
    }
    return this._domains;
  }

  async supportsUpdatesApp() {
    try {
      await this._getSpecificAuthorizationHeader(AppPurpose.Updates);
      return true;
    } catch (error) {
      return false;
    }
  }

  async requireUpdatesApp(functionName: string) {
    const supports = await this.supportsUpdatesApp();
    if (!supports) {
      throw new Error(
        `The ${this.name} organization is not configured to support the necessary Updates app to complete this operation: ${functionName}`
      );
    }
  }

  getRateLimitInformation(purpose: AppPurposeTypes) {
    const tokenManager = GitHubTokenManager.TryGetTokenManagerForOperations(this._operations as Operations);
    return tokenManager.getRateLimitInformation(purpose, this);
  }

  repository(name: string, optionalEntity?: CreateRepositoryEntity) {
    const entity = Object.assign({}, optionalEntity || {}, {
      name,
    });
    const repository = new Repository(
      this,
      entity,
      this._getAuthorizationHeader,
      this._getSpecificAuthorizationHeader,
      this._operations
    );
    // CONSIDER: Cache any repositories in the local instance
    return repository;
  }

  async getRepositoryById(id: number, options?: ICacheOptions): Promise<Repository> {
    options = options || {};
    const operations = this._operations;
    if (!id) {
      throw new Error('Must provide a repository ID to retrieve the repository.');
    }
    const parameters = {
      id,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.accountDetailStaleSeconds,
        options
      ),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const noConditionalRequests = (options as any)?.noConditionalRequests === true;
    try {
      let entity: CreateRepositoryEntity = null;
      const { github } = operations;
      const requirements = github.createRequirementsForRequest(
        this.authorize(AppPurpose.Data),
        'GET /repositories/:id'
      );
      if (noConditionalRequests) {
        entity = await operations.github.requestAsPostWithRequirements(requirements, parameters);
      } else {
        entity = await operations.github.requestWithRequirements(requirements, parameters, cacheOptions);
      }
      if (entity.owner.id !== this.id) {
        throw CreateError.NotFound(
          `Repository ID ${id} has a different owner of ${entity.owner.login} instead of ${this.name}. It has been relocated and will be treated as a 404.`
        );
      }
      return this.repositoryFromEntity(entity);
    } catch (error) {
      if (error.status && error.status === 404) {
        error = new Error(`The GitHub repository ID ${id} could not be found`);
        error.status = 404;
        throw error;
      }
      throw wrapError(error, `Could not get details about repository ID ${id}: ${error.message}`);
    }
  }

  async getRepositories(options?: IPagedCacheOptions): Promise<Repository[]> {
    options = options || {};
    const doNotProjectEntities = (options as any).doNotProjectEntities || false;
    delete (options as any).doNotProjectEntities;
    const operations = this._operations;
    const github = operations.github;
    const parameters = {
      org: this.name,
      type: 'all',
      per_page: getPageSize(operations),
    };
    const caching = {
      maxAgeSeconds: getMaxAgeSeconds(operations as Operations, CacheDefault.orgReposStaleSeconds, options),
      backgroundRefresh: true,
      pageRequestDelay: options.pageRequestDelay || null,
    };
    if (options && options.backgroundRefresh === false) {
      caching.backgroundRefresh = false;
    }
    const { rest } = github.octokit;
    const requirements = github.createRequirementsForFunction(
      this.authorize(AppPurpose.Data),
      rest.repos.listForOrg,
      'repos.listForOrg'
    );
    const repoEntities = await github.collections.collectAllPagesWithRequirements<any, any>(
      'orgRepos',
      requirements,
      parameters,
      caching,
      repoDetailsToCopy
    );
    if (doNotProjectEntities) {
      return repoEntities;
    }
    const repositories = common.createInstances<Repository>(this, this.repositoryFromEntity, repoEntities);
    return repositories;
  }

  async getOrgRunners(options?: ICacheOptions): Promise<IGitHubOrganizationRunners> {
    options = options || {};
    const operations = this._operations;
    const github = operations.github;
    const orgName = this.name;
    const parameters = {
      orgName,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: 1, // getMaxAgeSeconds(operations, CacheDefault.accountDetailStaleSeconds, options),
    };
    const runnerData = await operations.github.requestWithRequirements(
      github.createRequirementsForRequest(
        this.authorize(AppPurpose.ActionsData),
        'GET /orgs/:orgName/actions/runners',
        {
          permissions: {
            permission: 'organization_self_hosted_runners',
            access: 'read',
          },
        }
      ),
      parameters,
      cacheOptions
    );
    return {
      runners: runnerData.runners,
      total_count: runnerData.total_count,
    };
  }

  get priority(): string {
    return this._settings.properties['priority'] || 'secondary';
  }

  get isAppOnly(): boolean {
    return this._settings.hasFeature(OrganizationFeature.ApplicationHostOrganizationOnly) || false;
  }

  get locked(): boolean {
    return this._settings.hasFeature(OrganizationFeature.LockedMembership) || false;
  }

  get createRepositoriesOnGitHub(): boolean {
    return this._settings.hasFeature(OrganizationFeature.CreateNativeRepositories) || false;
  }

  get allowCreateRepositoriesByApiWhenNative() {
    if (
      this.createRepositoriesOnGitHub &&
      this._settings.hasFeature(OrganizationFeature.OverrideNativeFlagAllowCreateRepositoriesByApi)
    ) {
      return true;
    }
    return false;
  }

  get configuredOrganizationRepositoryTypes(): string {
    return this._settings.properties['type'] || 'public';
  }

  get privateEngineering(): boolean {
    return this._settings.hasFeature('privateEngineering') || false;
  }

  get externalMembersPermitted(): boolean {
    return this._settings.hasFeature('externalMembersPermitted') || false;
  }

  get preventLargeTeamPermissions(): boolean {
    return this._settings.hasFeature(OrganizationFeature.PreventLargeTeamPermissionGrants) || false;
  }

  get description(): string {
    return this._settings.portalDescription;
  }

  get webhookSharedSecrets(): string[] {
    const orgSettings = this._settings;
    // Multiple shared can be specified at the organization level to allow for rotation
    // NOTE: hook secrets are no longer moved over...
    const orgSpecificSecrets = orgSettings.properties['hookSecrets'] || [];
    const systemwideConfig = this._operations.providers.config;
    const systemwideSecrets =
      systemwideConfig.github &&
      systemwideConfig.github.webhooks &&
      systemwideConfig.github.webhooks.sharedSecret
        ? systemwideConfig.github.webhooks.sharedSecret
        : null;
    return _.concat([], orgSpecificSecrets, systemwideSecrets);
  }

  get broadAccessTeams(): number[] {
    return this.getSystemTeam(SystemTeam.Everyone, 'everyone membership');
  }

  get openAccessTeams(): number[] {
    return this.getSystemTeam(SystemTeam.OpenAccess, 'open access');
  }

  get invitationTeam(): Team {
    const teams = this.broadAccessTeams;
    if (teams.length > 1) {
      throw new Error('Multiple invitation teams are not supported.');
    }
    return teams.length === 1 ? this.team(teams[0]) : null;
  }

  get systemSudoersTeam(): Team {
    const teams = this.getSystemTeam(SystemTeam.GlobalSudo, 'system sudoers');
    if (teams.length > 1) {
      throw new Error('Multiple system sudoer teams are not supported.');
    }
    return teams.length === 1 ? this.team(teams[0]) : null;
  }

  get sudoersTeam(): Team {
    const teams = this.getSystemTeam(SystemTeam.Sudo, 'organization sudoers');
    if (teams.length > 1) {
      throw new Error('Multiple sudoer teams are not supported.');
    }
    return teams.length === 1 ? this.team(teams[0]) : null;
  }

  getDynamicSettings(): OrganizationSetting {
    if (!this.hasDynamicSettings) {
      throw CreateError.NotFound('This organization is not configured for dynamic settings');
    }
    return this._settings;
  }

  getSettings(): OrganizationSetting {
    return this._settings;
  }

  get specialSystemTeams() {
    return {
      read: this.getSystemTeam(SystemTeam.SystemRead, 'read everything'),
      write: this.getSystemTeam(SystemTeam.SystemWrite, 'write everything'),
      admin: this.getSystemTeam(SystemTeam.SystemAdmin, 'administer everything'),
    };
  }

  getAuthorizationHeader(purpose: AppPurposeTypes): PurposefulGetAuthorizationHeader {
    return purpose ? this._getAuthorizationHeader.bind(this, purpose) : this._getAuthorizationHeader;
  }

  async getUserDetailsByLogin(login: string, purpose?: AppPurposeTypes): Promise<IGitHubAccountDetails> {
    // This is a more basic version of the user API; unlike the operations-level function,
    // this does not return a strongly typed object with integrated REST access. The open
    // source project does not use this method.
    try {
      const response = (await this.requestUrl(`https://api.github.com/users/${login}`, {
        purpose: purpose || AppPurpose.Operations,
      })) as IGitHubAccountDetails;
      if (response?.id) {
        return response;
      }
    } catch (error) {
      throw error;
    }
  }

  async getOrganizationAdministrators(): Promise<IAdministratorBasics[]> {
    // returns an array containing an ID and properties 'owner' and 'sudo' for each
    const administrators = new Map<number, IAdministratorBasics>();
    function getAdministratorEntry(id: number, login: string) {
      let administrator = administrators.get(id);
      if (!administrator) {
        administrator = {
          id,
          login,
          sudo: false,
          owner: false,
        };
        administrators.set(id, administrator);
      }
      return administrator;
    }
    const owners = await this.getOwners();
    for (let i = 0; i < owners.length; i++) {
      const id = owners[i].id;
      const login = owners[i].login;
      getAdministratorEntry(id, login).owner = true;
    }
    const sudoTeam = this.sudoersTeam;
    if (!sudoTeam) {
      return Array.from(administrators.values());
    }
    try {
      const members = await sudoTeam.getMembers();
      for (let i = 0; i < members.length; i++) {
        const id = members[i].id;
        const login = members[i].login;
        getAdministratorEntry(id, login).sudo = true;
      }
      return Array.from(administrators.values());
    } catch (error) {
      if (error && error.status === 404) {
        // The sudo team no longer exists, but we should still have administrator information
        return Array.from(administrators.values());
      }
      throw error;
    }
  }

  get systemTeamIds(): number[] {
    const teamIds = [];
    const sudoTeamInstance = this.sudoersTeam;
    if (sudoTeamInstance) {
      teamIds.push(sudoTeamInstance.id);
    }
    const broadAccessTeams = this.broadAccessTeams;
    if (broadAccessTeams) {
      for (let i = 0; i < broadAccessTeams.length; i++) {
        teamIds.push(broadAccessTeams[i]); // is the actual ID, not the team object
      }
    }
    const openAccessTeams = this.openAccessTeams;
    if (openAccessTeams) {
      for (let i = 0; i < openAccessTeams.length; i++) {
        teamIds.push(openAccessTeams[i]); // is the actual ID, not the team object
      }
    }
    const specialTeams = this.specialSystemTeams;
    const keys = Object.getOwnPropertyNames(specialTeams);
    keys.forEach((type) => {
      const values = specialTeams[type];
      if (Array.isArray(values)) {
        Array.prototype.push.apply(teamIds, values);
      }
    });
    return teamIds;
  }

  get legalEntities(): string[] {
    const settings = this._settings;
    if (
      settings.legalEntities &&
      Array.isArray(settings.legalEntities) &&
      settings.legalEntities.length > 0
    ) {
      return settings.legalEntities;
    }
    const centralLegalEntities = this._operations.getDefaultLegalEntities();
    if (centralLegalEntities.length > 0) {
      return centralLegalEntities;
    }
    throw new Error(
      'No legal entities available or defined for the organization, or all organizations through the default value'
    );
  }

  async getRepositoryCreateGitHubToken(): Promise<AuthorizationHeaderValue> {
    // This method leaks/releases the owner token. In the future a more crisp
    // way of accomplishing this without exposing the token should be created.
    // The function name is specific to the intended use instead of a general-
    // purpose token name.
    const token = await (this.authorize(AppPurpose.Operations) as GetAuthorizationHeader)();
    token.source = 'repository create token';
    return token;
  }

  async createRepository(repositoryName: string, options): Promise<ICreateRepositoryResult> {
    // NOTE: we support a unique branching structure for creating from a template
    // TODO: create repository options interface
    const operations = this._operations;
    const orgName = this.name;
    delete options.name;
    delete options.org;
    const templateOwner: string = options?.template_owner;
    const templateRepo: string = options?.template_repo;
    const parameters = Object.assign(
      {
        org: orgName,
        name: repositoryName,
      },
      options
    );
    let restApiMethod = 'repos.createInOrg';
    if (templateOwner && templateRepo) {
      parameters.template_owner = templateOwner;
      parameters.template_repo = templateRepo;
      parameters.owner = orgName;
      delete parameters.org;
      restApiMethod = 'repos.createUsingTemplate';
    }
    try {
      const details = await operations.github.post(
        this.authorize(AppPurpose.Operations),
        restApiMethod,
        parameters
      );
      const newRepository = this.repositoryFromEntity(details);
      let response = details;
      try {
        response = StripGitHubEntity(GitHubResponseType.Repository, details, 'repos.createInOrg');
      } catch (parseError) {}
      const result: ICreateRepositoryResult = {
        repository: newRepository,
        response,
      };
      return result;
    } catch (error) {
      let contextualError = '';
      if (error.errors && Array.isArray(error.errors)) {
        contextualError = error.errors.map((errorEntry: Error) => errorEntry.message).join(', ') + '. ';
      } else if ((error as Error).message) {
        contextualError = (error as Error).message + '. ';
      }
      const friendlyErrorMessage = `${contextualError}Could not create the repository ${orgName}/${repositoryName}`;
      throw wrapError(error, friendlyErrorMessage);
    }
  }

  async getDetails(options?: GetDetailsOptions): Promise<GitHubOrganizationResponse> {
    options = options || {};
    const { github } = this._operations;
    const { rest } = github.octokit;
    let entity: GitHubOrganizationResponse;
    try {
      if (options?.lookupById) {
        if (!this.id) {
          throw CreateError.InvalidParameters('The organization ID is not set in this instance.');
        }
        const id = this.id;
        entity = await github.requestWithRequirements(
          github.createRequirementsForRequest(this.authorize(AppPurpose.Data), 'GET /organizations/:org_id'),
          {
            org_id: id,
          }
        );
      } else {
        entity = await github.callWithRequirements(
          github.createRequirementsForFunction(this.authorize(AppPurpose.Data), rest.orgs.get, 'orgs.get'),
          {
            org: this.name,
          }
        );
      }
    } catch (error) {
      throw wrapError(error, `Could not get details about the ${this.name} organization: ${error.message}`);
    }
    if (entity && entity.id) {
      this.id = entity.id;
    }
    this._entity = entity;
    return entity;
  }

  getRepositoryCreateMetadata(options?: any) {
    const settings = this._settings;
    const config = this._operations.providers.config;
    const metadata = {
      approval: {
        fields: config.github.approvalTypes ? config.github.approvalTypes.fields : undefined,
      },
      legalEntities: this.legalEntities,
      gitIgnore: {
        default: settings.properties['defaultGitIgnoreLanguage'] || config.github.gitignore.default,
        languages: config.github.gitignore.languages,
      },
      templates: this.sanitizedRepositoryCreateTemplates(options || {}),
      visibilities: this.getSupportedNewRepositoryVisibilitiesByPriority(),
    };
    return metadata;
  }

  async getTeamById(id: number, options?: ICacheOptions): Promise<Team> {
    options = options || {};
    const operations = this._operations;
    const cacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgTeamDetailsStaleSeconds,
        options
      ),
      backgroundRefresh: false,
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const orgId = this.id;
    if (!orgId) {
      throw CreateError.InvalidParameters('The organization ID is not available.');
    }
    const parameters = {
      org_id: orgId,
      team_id: id,
    };
    const { github } = operations;
    try {
      const entity = await github.requestWithRequirements(
        github.createRequirementsForRequest(
          this.authorize(AppPurpose.Data),
          'GET /organizations/:org_id/team/:team_id',
          {
            usePermissionsFromAlternateUrl: '/orgs/{org}/teams/{team_slug}',
          }
        ),
        parameters,
        cacheOptions
      );
      return this.teamFromEntity(entity);
    } catch (error) {
      if (error.status && error.status === 404) {
        throw CreateError.NotFound(
          `The GitHub team with the ID ${id} could not be found for organization ${this.name} with ID ${orgId}.`
        );
      }
      throw error;
    }
  }

  async getTeamFromSlug(slug: string, options?: ICacheOptions): Promise<Team> {
    options = options || {};
    const operations = this._operations;
    const cacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgTeamDetailsStaleSeconds,
        options
      ),
      backgroundRefresh: false,
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const parameters = {
      org: this.name,
      team_slug: slug,
    };
    const { github } = operations;
    const { rest } = github.octokit;
    try {
      const entity = await operations.github.callWithRequirements(
        github.createRequirementsForFunction(
          this.authorize(AppPurpose.Data),
          rest.teams.getByName,
          'teams.getByName'
        ),
        parameters,
        cacheOptions
      );
      return this.teamFromEntity(entity);
    } catch (error) {
      if (error.status && error.status === 404) {
        error = new Error(`The GitHub team with the slug ${slug} could not be found`);
        error.status = 404;
        throw error;
      }
      throw error;
    }
  }

  async getTeamFromName(nameOrSlug: string, options?: ICacheOptions): Promise<Team> {
    options = options || {};
    const operations = this._operations;
    // Slightly more aggressive attempt to look for the latest team
    // information to help prevent downtime when a new team is created
    if (!options.maxAgeSeconds) {
      options.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.orgTeamsSlugLookupStaleSeconds
      );
    }
    // Try a direct slug lookup first, for better performance
    try {
      const team = await this.getTeamFromSlug(nameOrSlug);
      if (team) {
        return team;
      }
    } catch (teamSlugLookupError) {
      if (ErrorHelper.IsNotFound(teamSlugLookupError)) {
        // that's OK...
      } else {
        console.log('teamSlugLookupError:');
        console.warn(teamSlugLookupError);
      }
    }
    const expected = nameOrSlug.toLowerCase();
    const teams = await this.getTeams(options);
    let alternativeCandidateById: Team = null;
    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      const name = team.name.toLowerCase();
      const slug = team.slug.toLowerCase();
      // Considered a light error condition, this will callback with
      // both a suggestion to redirect to the slug-based name and
      // a legitimate link to the team in the error;
      // TODO: hook up this new change
      if (expected === name && name !== slug) {
        const redirectError: IRedirectError = new Error(`The team is also available by slug: ${slug}.`);
        redirectError.status = 301;
        redirectError.slug = slug;
        redirectError.team = team;
        throw redirectError;
      }
      if (team.id.toString() == /* loose */ expected) {
        alternativeCandidateById = team;
      }
      if (expected === slug) {
        return team;
      }
    }
    if (alternativeCandidateById) {
      const redirectError: IRedirectError = new Error(
        `The team is also available by slug: ${alternativeCandidateById.slug}.`
      );
      redirectError.status = 301;
      redirectError.slug = alternativeCandidateById.slug;
      redirectError.team = alternativeCandidateById;
      throw alternativeCandidateById;
    }
    const teamNotFoundError: IReposError = new Error(
      'No team was found within the organization matching the provided name'
    );
    teamNotFoundError.status = 404;
    teamNotFoundError.skipLog = true;
    throw teamNotFoundError;
  }

  async getAuthorizedOperationsAccount(): Promise<IAccountBasics> {
    const operations = this._operations;
    // LEARN: what happens if this is a bot account?
    try {
      const header = this.authorize(AppPurpose.Operations);
      const value = await header();
      if (value?.installationId) {
        throw jsonError(`GitHub Apps are being used`, 400);
      }
      const entity = await operations.github.post(header, 'users.getAuthenticated', {});
      return entity as IAccountBasics;
    } catch (error) {
      throw wrapError(error, 'Could not get details about the authenticated account');
    }
  }

  team(id: number, optionalEntity?): Team {
    const entity = optionalEntity || {};
    if (!optionalEntity) {
      entity.id = id;
    }
    const team = new Team(
      this,
      entity,
      this._getAuthorizationHeader.bind(this),
      this._operations as Operations
    );
    return team;
  }

  member(id: number, optionalEntity?): OrganizationMember {
    const entity = optionalEntity || {};
    if (!optionalEntity) {
      entity.id = id;
    }
    const member = new OrganizationMember(this, entity, this._operations);
    return member;
  }

  getOwners(options?: IPagedCacheOptions): Promise<OrganizationMember[] /* TODO: validate return type */> {
    const memberOptions = Object.assign({}, options) as GetOrganizationMembersOptions;
    memberOptions.role = OrganizationMembershipRoleQuery.Admin;
    return this.getMembers(memberOptions);
  }

  async getAuditLog(options?: IGetAuditLogOptions): Promise<GitHubAuditLogEntry[]> {
    options = options || {};
    const operations = this._operations;
    const name = this.name;
    const parameters = {
      org: name,
      phrase: options.phrase,
      include: options.include,
      after: options.after,
      before: options.before,
      order: options.order,
      per_page: getPageSize(operations, options),
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.accountDetailStaleSeconds,
        options
      ),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const { github } = operations;
    try {
      // TODO: consider using the generic GET request method below
      const entities = (await github.requestWithRequirements(
        github.createRequirementsForRequest(this.authorize(AppPurpose.Data), 'GET /orgs/:org/audit-log', {
          permissions: {
            permission: 'organization_administration',
            access: 'read',
          },
        }),
        parameters,
        cacheOptions
      )) as GitHubAuditLogEntry[];
      // common.assignKnownFieldsPrefixed(this, entity, 'account', primaryAccountProperties, secondaryAccountProperties);
      return entities;
    } catch (error) {
      if (error.status && error.status === 404) {
        error = new Error(`The GitHub audit log endpoint is not available for the ${this.name} organization`);
        error.status = 404;
        throw error;
      }
      throw wrapError(error, `Could not get the audit log for the ${this.name} org: ${error.message}`);
    }
  }

  async requestUrl(url: string, options?: ICacheOptionsWithPurpose): Promise<any> {
    options = options || {};
    const operations = this._operations;
    const parameters = {};
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.accountDetailStaleSeconds,
        options,
        60
      ),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const purpose = options.purpose || AppPurpose.Data;
    let relativeUrl = '/';
    const asOperations = operations as Operations;
    if (asOperations?.getRelativeApiUrl) {
      relativeUrl = asOperations.getRelativeApiUrl(url);
    } else {
      const asUrl = new URL(url);
      relativeUrl = asUrl.pathname;
    }
    const { github } = operations;
    const value = await github.requestWithRequirements(
      github.createRequirementsForRequest(this.authorizeSpecificPurpose(purpose), `GET ${relativeUrl}`),
      parameters,
      cacheOptions
    );
    return value;
  }

  async isSudoer(username: string, link: ICorporateLink): Promise<boolean> {
    return await this._organizationSudo.isSudoer(username, link);
  }

  async acceptOrganizationInvitation(userToken: string): Promise<IOrganizationMembership> {
    const operations = this._operations;
    const parameters = {
      org: this.name,
      state: 'active',
    };
    try {
      const response = await operations.github.post(
        `token ${userToken}`,
        'orgs.updateMembershipForAuthenticatedUser',
        parameters
      );
      return response;
    } catch (error) {
      const wrappedError = wrapError(
        error,
        `Could not accept your invitation for the ${this.name} organization on GitHub`
      );
      if (error.status === 403 && error.response?.headers && error.response.headers['x-github-sso']) {
        const xGitHubSso = error.response.headers['x-github-sso'] as string;
        const i = xGitHubSso.indexOf('url=');
        if (i >= 0) {
          const remainder = xGitHubSso.substr(i + 4);
          console.log(`remaining SSO URL: ${remainder}`);
          wrappedError['x-github-sso-url'] = remainder;
        }
      }
      throw wrappedError;
    }
  }

  async getMembership(username: string, options?: ICacheOptions): Promise<IOrganizationMembership> {
    options = options || {};
    const orgName = this.name;
    const parameters = {
      username: username,
      org: orgName,
    };
    const operations = this._operations;
    const { github } = operations;
    const { rest } = github.octokit;
    try {
      const result = await github.callWithRequirements(
        github.createRequirementsForFunction(
          this.authorize(AppPurpose.Operations),
          rest.orgs.getMembershipForUser,
          'orgs.getMembershipForUser'
        ),
        parameters
      );
      return result;
    } catch (error) {
      if (error.status == /* loose */ 404) {
        return null;
      }
      let reason = error.message;
      if (error.status) {
        reason += ' ' + error.status;
      }
      const wrappedError = wrapError(
        error,
        `Trouble retrieving the membership for "${username}" in the ${orgName} organization.`
      );
      if (error.status) {
        wrapError['status'] = error.status;
      }
      throw wrappedError;
    }
  }

  async getOperationalMembership(username: string): Promise<IOrganizationMembership> {
    if (!username) {
      throw new Error('username must be provided');
    }
    // This is a specific version of the getMembership function that takes
    // no options and never allows for caching [outside of the standard
    // e-tag validation with the real-time GitHub API]
    return await this.getMembership(username, NoCacheNoBackground);
  }

  async isOwner(username: string) {
    const membership = await this.getOperationalMembership(username);
    return (
      membership?.state === OrganizationMembershipState.Active &&
      membership?.role === OrganizationMembershipRole.Admin
    );
  }

  async addMembership(
    username: string,
    options?: IAddOrganizationMembershipOptions
  ): Promise<IOrganizationMembership> {
    const operations = this._operations;
    const github = operations.github;
    options = options || {};
    const role = options.role || 'member';
    const parameters = {
      org: this.name,
      username: username,
      role: role,
    };
    const ok = await github.post(
      this.authorize(AppPurpose.Operations),
      'orgs.setMembershipForUser',
      parameters
    );
    return ok as IOrganizationMembership; // state: pending or active, role: admin or member
  }

  async checkPublicMembership(username: string, options?: ICacheOptions): Promise<boolean> {
    // NOTE: This method is unable to be cached by the underlying
    // system since there is no etag returned for status code-only
    // results.
    options = options || {};
    const parameters: ICheckPublicMembershipParameters = {
      username: username,
      org: this.name,
    };
    const operations = this._operations;
    parameters.allowEmptyResponse = true;
    try {
      await operations.github.post(
        this.authorize(AppPurpose.CustomerFacing),
        'orgs.checkPublicMembershipForUser',
        parameters
      );
      return true;
    } catch (error) {
      // The user either is not a member of the organization, or their membership is concealed
      if (error && error.status == /* loose */ 404) {
        return false;
      }
      throw wrapError(
        error,
        `Trouble retrieving the public membership status for ${username} in the ${this.name} organization: ${error.message}`
      );
    }
  }

  async concealMembership(login: string, userToken: string): Promise<void> {
    // This call required a provider user token with the expanded write:org scope
    const operations = this._operations;
    const parameters = {
      org: this.name,
      username: login,
    };
    try {
      const ok = await operations.github.post(
        `token ${userToken}`,
        'orgs.removePublicMembershipForAuthenticatedUser',
        parameters
      );
    } catch (error) {
      throw wrapError(
        error,
        `Could not conceal the ${this.name} organization membership for  ${login}: ${error.message}`
      );
    }
  }

  async publicizeMembership(login: string, userToken: string): Promise<void> {
    // This call required a provider user token with the expanded write:org scope
    const operations = this._operations;
    const parameters = {
      org: this.name,
      username: login,
    };
    try {
      await operations.github.post(
        `token ${userToken}`,
        'orgs.setPublicMembershipForAuthenticatedUser',
        parameters
      );
    } catch (error) {
      throw wrapError(
        error,
        `Could not publicize the ${this.name} organization membership for  ${login}: ${error.message}`
      );
    }
  }

  async getInstallation(purpose: AppPurposeTypes) {
    const operations = this._operations;
    const tokens = GitHubTokenManager.TryGetTokenManagerForOperations(operations as Operations);
    const installation = await tokens.getInstallationForOrganization(this, purpose);
    return installation;
  }

  async getMembers(options?: GetOrganizationMembersOptions): Promise<OrganizationMember[]> {
    options = options || {};
    const doNotProjectEntities = options.doNotProjectEntities || false;
    delete options.doNotProjectEntities;
    const operations = this._operations;
    const github = operations.github;
    const parameters: IGetMembersParameters = {
      org: this.name,
      per_page: getPageSize(operations),
    };
    if (options.filter) {
      parameters.filter = options.filter;
    }
    if (options.role) {
      parameters.role = options.role;
    }
    const caching = {
      maxAgeSeconds: getMaxAgeSeconds(operations as Operations, CacheDefault.orgMembersStaleSeconds, options),
      backgroundRefresh: true,
      pageRequestDelay: options.pageRequestDelay,
    };
    if (options && options.backgroundRefresh === false) {
      caching.backgroundRefresh = false;
    }
    const { rest } = github.octokit;
    const memberEntities = await github.collections.collectAllPagesWithRequirements<any, any>(
      'orgMembers',
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Data),
        rest.orgs.listMembers,
        'orgs.listMembers',
        {
          permissions: {
            permission: 'members',
            access: 'read',
          },
          permissionsMatchRequired: true,
        }
      ),
      parameters as any,
      caching,
      memberDetailsToCopy
    );
    if (doNotProjectEntities) {
      return memberEntities;
    }
    const members = common.createInstances<OrganizationMember>(this, this.memberFromEntity, memberEntities);
    return members;
  }

  getMembersWithoutTwoFactor(options?: IPagedCacheOptions): Promise<any> {
    const clonedOptions: GetOrganizationMembersOptions = Object.assign({}, options || {});
    clonedOptions.filter = OrganizationMembershipTwoFactorFilter.TwoFactorOff;
    return this.getMembers(clonedOptions);
  }

  async isMemberSingleFactor(username: string, options?: IPagedCacheOptions): Promise<boolean> {
    const membersWithoutTwoFactor = await this.getMembersWithoutTwoFactor(options);
    const lowerCase = username.toLowerCase();
    for (let i = 0; i < membersWithoutTwoFactor.length; i++) {
      const lc = membersWithoutTwoFactor[i].login.toLowerCase();
      if (lowerCase === lc) {
        return true;
      }
    }
    return false;
  }

  private async getMemberPairs(options?: GetOrganizationMembersOptions): Promise<IOrganizationMemberPair[]> {
    const members = await this.getMembers(options);
    const operations = this._operations;
    const linksArray = await operations.getLinks();
    const links = new Map<string, ICorporateLink>();
    for (const link of linksArray) {
      links.set(link.thirdPartyUsername.toLowerCase(), link);
    }
    return members.map((member) => {
      return {
        member,
        link: links.get(member.login.toLowerCase()),
      };
    });
  }

  async getServiceAccounts(
    excludeSystemAccounts: boolean,
    options?: GetOrganizationMembersOptions
  ): Promise<IOrganizationMemberPair[]> {
    const operations = this._operations;
    const pairs = await this.getMemberPairs(options);
    let accounts = pairs.filter((pair) => pair.link && pair.link.isServiceAccount);
    if (excludeSystemAccounts) {
      accounts = accounts.filter((pair) => !operations.isSystemAccountByUsername(pair.member.login));
    }
    return accounts;
  }

  async getLinkedMembers(options?: GetOrganizationMembersOptions): Promise<IOrganizationMemberPair[]> {
    const pairs = await this.getMemberPairs(options);
    return pairs.filter((pair) => pair.link);
  }

  async getUnlinkedMembers(options?: GetOrganizationMembersOptions): Promise<OrganizationMember[]> {
    const pairs = await this.getMemberPairs(options);
    return pairs.filter((pair) => !pair.link).map((entry) => entry.member);
  }

  async getTeams(options?: IPagedCacheOptions): Promise<Team[]> {
    options = options || {};
    const doNotProjectEntities = (options as any).doNotProjectEntities || false;
    delete (options as any).doNotProjectEntities;
    const operations = this._operations;
    const github = operations.github;
    const parameters = {
      org: this.name,
      per_page: getPageSize(operations),
    };
    const caching: IPagedCacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(operations as Operations, CacheDefault.orgTeamsStaleSeconds, options),
      backgroundRefresh: true,
      pageRequestDelay: options.pageRequestDelay || null,
    };
    caching.backgroundRefresh = options.backgroundRefresh;
    const { rest } = github.octokit;
    const requirements = github.createRequirementsForFunction(
      this.authorize(AppPurpose.Data),
      rest.teams.list,
      'teams.list'
    );
    const teamEntities = await github.collections.collectAllPagesWithRequirements<any, any>(
      'orgTeams',
      requirements,
      parameters,
      caching,
      teamDetailsToCopy
    );
    if (doNotProjectEntities) {
      return teamEntities;
    }
    const teams = common.createInstances<Team>(this, this.teamFromEntity, teamEntities);
    return teams;
  }

  async removeMember(login: string, optionalId?: string): Promise<void> {
    const operations = this._operations;
    const queryCache = operations.providers.queryCache;
    const parameters = {
      org: this.name,
      username: login,
    };
    try {
      await operations.github.post(
        this.authorize(AppPurpose.Operations),
        'orgs.removeMembershipForUser',
        parameters
      );
      if (queryCache?.supportsOrganizationMembership) {
        try {
          if (!optionalId) {
            const account = await operations.getAccountByUsername(login);
            optionalId = account.id.toString();
          }
          await queryCache.removeOrganizationMember(this.id.toString(), optionalId);
        } catch (ignored) {}
      }
    } catch (error) {
      throw wrapError(error, `Could not remove the organization member ${login}: ${error}`);
    }
  }

  async getMembershipInvitations(): Promise<GitHubOrganizationInvite[]> {
    const operations = this._operations;
    const parameters = {
      org: this.name,
    };
    const { github } = operations;
    const { rest } = github.octokit;
    try {
      const invitations = await github.callWithRequirements(
        github.createRequirementsForFunction(
          this.authorize(AppPurpose.Operations),
          rest.orgs.listPendingInvitations,
          'orgs.listPendingInvitations'
        ),
        parameters
      );
      return invitations as GitHubOrganizationInvite[];
    } catch (error) {
      if (error.status == /* loose */ 404) {
        return null;
      }
      throw error;
    }
  }

  private authorize(purpose: AppPurpose): GetAuthorizationHeader {
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(this, purpose) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }

  private authorizeSpecificPurpose(purpose: AppPurposeTypes): GetAuthorizationHeader {
    const getAuthorizationHeader = this._getSpecificAuthorizationHeader.bind(
      this,
      purpose
    ) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }

  private sanitizedRepositoryCreateTemplates(options) {
    return this.repositoryCreateTemplates(options).map((template) => {
      return {
        id: template.id,
        spdx: template.spdx,
        name: template.name,
        environments: template.environments,
        legalEntities: template.legalEntities,
      };
    });
  }

  private repositoryCreateTemplates(options) {
    const operations = this._operations as Operations;
    options = options || {};
    const projectType = options.projectType;
    // projectType option:
    // if any only if present in the request AND there is a 'forceForReleaseType'
    // value set on at least one template, return only the set of 'forced'
    // templates. the scenario enabled here is to allow sample code to always
    // force one of the official sample code templates and not fallback to
    // standard templates.
    const config = operations.providers.config;
    const templates = [];
    const configuredTemplateRoot = config.github.templates || ({} as ConfigGitHubTemplates);
    const configuredTemplateDefinitions =
      configuredTemplateRoot && configuredTemplateRoot.definitions ? configuredTemplateRoot.definitions : {};
    const templateDefinitions = configuredTemplateDefinitions || {};
    const allTemplateNames = Object.getOwnPropertyNames(templateDefinitions);
    const fallbackTemplates = operations.getDefaultRepositoryTemplateNames() || allTemplateNames;
    const ts =
      this._settings.templates && this._settings.templates.length > 0
        ? this._settings.templates
        : fallbackTemplates;
    const legalEntities = this.legalEntities;
    const limitedTypeTemplates = [];
    ts.forEach((templateId) => {
      const td = templateDefinitions[templateId];
      const candidateTemplate = Object.assign({ id: templateId }, td);
      let template = null;
      if (candidateTemplate.legalEntity) {
        for (let i = 0; i < legalEntities.length && !template; i++) {
          if (legalEntities[i].toLowerCase() === candidateTemplate.legalEntity.toLowerCase()) {
            template = candidateTemplate;
            template.legalEntities = [template.legalEntity];
            delete template.legalEntity;
          }
        }
      } else {
        candidateTemplate.legalEntities = legalEntities;
        template = candidateTemplate;
      }
      if (template && template.name) {
        templates.push(template);
        if (projectType && template.forceForReleaseType && template.forceForReleaseType == projectType) {
          limitedTypeTemplates.push(template);
        }
      }
    });
    if (projectType && limitedTypeTemplates.length) {
      return limitedTypeTemplates;
    }
    return templates;
  }

  // Specialized features, opt-in only

  isNewRepositoryLockdownSystemEnabled() {
    return (
      this._operations.allowUnauthorizedNewRepositoryLockdownSystemFeature() &&
      this._settings.hasFeature('new-repository-lockdown-system')
    );
  }

  isForkLockdownSystemEnabled() {
    return (
      this._operations.allowUnauthorizedForkLockdownSystemFeature() &&
      this._settings.hasFeature(OrganizationFeature.LockNewForks)
    );
  }

  isForkDeleteSystemEnabled() {
    return (
      this._operations.allowUnauthorizedForkLockdownSystemFeature() &&
      this._settings.hasFeature(OrganizationFeature.DeleteNewForks)
    );
  }

  isTransferLockdownSystemEnabled() {
    return (
      this._operations.allowTransferLockdownSystemFeature() &&
      this._settings.hasFeature(OrganizationFeature.LockTransfers)
    );
  }

  // Helper functions

  memberFromEntity(entity): OrganizationMember {
    return this.member(entity.id, entity);
  }

  teamFromEntity(entity): Team {
    return this.team(entity.id, entity);
  }

  repositoryFromEntity(entity: CreateRepositoryEntity): Repository {
    return this.repository(entity.name, entity);
  }

  getLegacySystemObjects() {
    const settings = this._settings;
    const operations = this._operations;
    return { settings, operations };
  }

  private getSystemTeam(teamType: SystemTeam, friendlyName: string, throwIfMissing?: boolean): number[] {
    const allOrgSystemTeams = this._settings.specialTeams;
    const matchingSystemTeamTypes = allOrgSystemTeams.filter((t) => t.specialTeam === teamType);
    const teams: number[] = matchingSystemTeamTypes.map((t) => t.teamId);
    if (throwIfMissing && teams.length === 0) {
      throw new Error(
        `Missing configured organization "${this.name}" special team ${teamType} - ${friendlyName}`
      );
    }
    return teams;
  }

  private getSupportedNewRepositoryVisibilitiesByPriority() {
    // Returns the types of repositories that can be created by users by default.
    const settings = this._settings;
    const type = settings.properties['type'] || GitHubRepositoryVisibility.Public;
    const types = [GitHubRepositoryVisibility.Public];
    switch (type) {
      case 'public':
        break;
      case 'publicprivate':
        types.push(GitHubRepositoryVisibility.Private);
        break;
      case 'private':
        types.splice(0, 1, GitHubRepositoryVisibility.Private);
        break;
      case 'privatepublic':
        types.splice(0, 0, GitHubRepositoryVisibility.Private);
        break;
      default:
        throw CreateError.InvalidParameters(
          `Unsupported configuration for repository types in the organization: ${type}`
        );
    }
    return types;
  }
}

const repoDetailsToCopy = RepositoryPrimaryProperties;
const memberDetailsToCopy = Collaborator.PrimaryProperties;
const teamDetailsToCopy = Team.PrimaryProperties;
