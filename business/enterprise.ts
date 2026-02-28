//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { GraphqlResponseError } from '@octokit/graphql';

import { GitHubTokenType, getGitHubTokenTypeFromValue } from '../lib/github/appTokens.js';
import { CreateError, ErrorHelper } from '../lib/transitional.js';
import {
  createPagedCacheOptions,
  GetInvisibleOrganizationOptions,
  getPageSize,
  symbolizeApiResponse,
} from './operations/core.js';
import { Organization } from './organization.js';

import GitHubEnterpriseBilling from './enterpriseBilling.js';
// import GitHubEnterpriseCopilot from ...; // this is a placeholder for an eventual import

import type {
  GetAuthorizationHeader,
  GitHubSimpleAccount,
  IGitHubAppInstallation,
  IPagedCacheOptions,
  IProviders,
} from '../interfaces/index.js';
import {
  getAppPurposeId,
  GitHubAppConfiguration,
  isCustomAppPurpose,
  AppPurposeTypes,
  isCustomAppPurposeWithGetTargetedAppInstance,
  isCustomAppPurposeWithGetAppInstance,
  GitHubAppAuthenticationType,
} from '../lib/github/appPurposes.js';
import {
  BasicGitHubAppInstallation,
  OrganizationFeature,
  OrganizationSetting,
} from './entities/organizationSettings/organizationSetting.js';
import GitHubApplication from './application.js';

// TODO: paginate across enterprise fix + support iterators

type AppAndInstallationIds = Omit<BasicGitHubAppInstallation, 'appPurposeId'>;

type EnterpriseMemberBasics = {
  __typename: string;
  id: string;
  login: string;
};

export enum EnterpriseUserAccountMembershipRole {
  Member = 'MEMBER',
  Owner = 'OWNER',
  Unaffiliated = 'UNAFFILIATED',
}

const ENTERPRISE_ROLES = [
  EnterpriseUserAccountMembershipRole.Member,
  EnterpriseUserAccountMembershipRole.Owner,
  EnterpriseUserAccountMembershipRole.Unaffiliated,
];

export type EnterpriseSamlExternalIdentityBasics = {
  id: string;
  user: {
    login: string;
  };
  samlIdentity: {
    nameId: string;
  };
};

export type GitHubAppOrganizationInstallation = {
  app_slug: string;
  client_id: string;
  created_at: string;
  events: string[];
  id: number;
  permissions: Record<string, string>;
  repositories_url: string;
  repository_selection: GitHubAppInstallationRepositoryScope;
  updated_at: string;
};

export type GitHubAppOrganizationInstallationDetail = GitHubAppOrganizationInstallation & {
  account: GitHubSimpleAccount;
  app_id: number;
  target_id: number;
  target_type: string;
  // technically some html_url, other ones; suspended_at, etc.
};

export type GitHubAppInstallationRepositoryAssignment = {
  full_name: string;
  id: number;
  name: string;
};

export enum GitHubAppInstallationRepositoryScope {
  All = 'all',
  Selected = 'selected',
  None = 'none',
}

export type GitHubAppInstallationRepositoryOptions = {
  repository_selection: GitHubAppInstallationRepositoryScope;
  repositories?: string[];
};

export type EnterpriseOrganizationBasics = {
  id: string;
  name: string;
  login: string;
  viewerCanAdminister: boolean;
};

export type EnterpriseSamlExternalIdentityNode = {
  node: EnterpriseSamlExternalIdentityBasics;
};

function isStringToken(token: string | GetAuthorizationHeader): token is string {
  return typeof token === 'string';
}

type EnterpriseOptions = {
  fixedPurpose?: AppPurposeTypes;
  useEnterpriseTokenForOrganizations?: boolean;
};

export default class GitHubEnterprise {
  private _billing: GitHubEnterpriseBilling;

  private _graphqlNodeId: string;
  private _knownOrgInstallations = new Map<
    string,
    IGitHubAppInstallation | GitHubAppOrganizationInstallationDetail
  >();
  private _invisibleOrganizations = new Map<string, Organization>();

  constructor(
    private providers: IProviders,
    public slug: string,
    private enterpriseToken: string | GetAuthorizationHeader,
    private options?: EnterpriseOptions
  ) {
    if (isStringToken(enterpriseToken)) {
      if (enterpriseToken.startsWith('bearer')) {
        throw CreateError.InvalidParameters('Bearer tokens not accepted');
      }
      if (!enterpriseToken.startsWith('token ')) {
        throw CreateError.InvalidParameters('Token must start with "token "');
      }
      if (
        getGitHubTokenTypeFromValue(enterpriseToken) !== GitHubTokenType.PersonalAccessToken &&
        getGitHubTokenTypeFromValue(enterpriseToken) !== GitHubTokenType.ServerToServerToken
      ) {
        throw CreateError.InvalidParameters(
          'Only PATs and Enterprise GitHub Apps are supported for enterprise-scoped GitHub Enterprise Cloud APIs'
        );
      }
    }
  }

  setGraphqlNodeId(id: string) {
    this._graphqlNodeId = id;
  }

  private requireGraphqlNodeId() {
    if (!this._graphqlNodeId) {
      throw CreateError.InvalidParameters(
        'GraphQL node ID not set. Please call setGraphqlNodeId with the enterprise ID.'
      );
    }
    return this._graphqlNodeId;
  }

  get copilot() {
    throw CreateError.NotImplemented('Copilot APIs are not available in this version of the code.');
  }

  get billing() {
    if (!this._billing) {
      if (!isStringToken(this.enterpriseToken)) {
        throw CreateError.InvalidParameters(
          'Billing APIs currently require a string token. Please use a separate instance.'
        );
      }
      this._billing = new GitHubEnterpriseBilling(this.providers, this, this.enterpriseToken);
    }
    return this._billing;
  }

  async getId(): Promise<string> {
    // ISSUE: this is broken for enterprise-scoped GitHub Apps... JWilcox reported.
    const github = this.providers.github;
    try {
      const response = await github.graphql(
        this.enterpriseToken,
        queries.getEnterprise,
        {
          enterpriseName: this.slug,
        },
        {
          paginate: false,
        }
      );
      const value = response?.enterprise?.id;
      return value;
    } catch (error) {
      throw error;
    }
  }

  // Apps

  async getGitHubAppInstallationsForOrganization(orgName: string, options?: IPagedCacheOptions) {
    const operations = this.providers.operations;
    const { github } = operations;
    options = options || {};
    const parameters = {
      per_page: getPageSize(operations),
      enterprise: this.slug,
      org: orgName,
    };
    const cacheOptions = createPagedCacheOptions(operations, options);
    try {
      const entities = await github.collections.collectAllPagesViaHttpGetWithRequirements<
        any,
        GitHubAppOrganizationInstallation
      >(
        'entOrgGitHubAppInstalls',
        github.createRequirementsForRequest(
          this.enterpriseToken,
          'GET /enterprises/:enterprise/apps/organizations/:org/installations',
          {
            permissions: {
              permission: 'enterprise_organization_installations',
              access: 'write',
            },
          }
        ),
        parameters,
        cacheOptions
      );
      return symbolizeApiResponse<GitHubAppOrganizationInstallation[]>(entities);
    } catch (error) {
      throw error;
    }
  }

  async getGitHubAppInstallationRepositories(
    orgName: string,
    installationId: number,
    options?: IPagedCacheOptions
  ) {
    const operations = this.providers.operations;
    const { github } = operations;
    options = options || {};
    const parameters = {
      per_page: getPageSize(operations),
      enterprise: this.slug,
      installation_id: installationId,
      org: orgName,
    };
    const cacheOptions = createPagedCacheOptions(operations, options);
    try {
      const entities = await github.collections.collectAllPagesViaHttpGetWithRequirements<
        any,
        GitHubAppInstallationRepositoryAssignment
      >(
        'entOrgGitHubAppInstallRepos',
        github.createRequirementsForRequest(
          this.enterpriseToken,
          'GET /enterprises/:enterprise/apps/organizations/:org/installations/:installation_id/repositories',
          {
            permissions: {
              permission: 'enterprise_organization_installation_repositories',
              access: 'write',
            },
          }
        ),
        parameters,
        cacheOptions
      );
      return symbolizeApiResponse<GitHubAppInstallationRepositoryAssignment[]>(entities);
    } catch (error) {
      throw error;
    }
  }

  async addRepositoryToGitHubAppInstallation(
    orgName: string,
    installationId: number,
    repositoryNames: string[]
  ) {
    const operations = this.providers.operations;
    const { github } = operations;
    // const { rest } = operations.github.octokit;
    const requirements = github.createRequirementsForRequest(
      this.enterpriseToken,
      'PATCH /enterprises/:enterprise/apps/organizations/:org/installations/:installation_id/repositories/add',
      {
        permissions: {
          permission: 'enterprise_organization_installation_repositories',
          access: 'write',
        },
        permissionsMatchRequired: true,
      }
    );
    const parameters = {
      enterprise: this.slug,
      org: orgName,
      installation_id: installationId,
      repositories: repositoryNames,
    };
    try {
      const outcome = (await github.requestAsPostWithRequirements(
        requirements,
        parameters as unknown as Record<string, string | number | boolean>
      )) as GitHubAppInstallationRepositoryAssignment[];
      return outcome;
    } catch (error) {
      throw error;
    }
  }

  async installGitHubAppOnOrganization(
    orgName: string,
    clientId: string,
    options: GitHubAppInstallationRepositoryOptions
  ) {
    const operations = this.providers.operations;
    const { github } = operations;
    const requirements = github.createRequirementsForRequest(
      this.enterpriseToken,
      'POST /enterprises/:enterprise/apps/organizations/:org/installations',
      {
        permissions: {
          permission: 'enterprise_organization_installations',
          access: 'write',
        },
        permissionsMatchRequired: true,
      }
    );
    const parameters: any = {
      enterprise: this.slug,
      org: orgName,
      client_id: clientId,
      repository_selection: options.repository_selection,
    };
    if (options.repository_selection === GitHubAppInstallationRepositoryScope.Selected) {
      parameters.repositories = options.repositories;
    }
    try {
      const outcome = (await github.requestAsPostWithRequirements(
        requirements,
        parameters as unknown as Record<string, string | number | boolean>
      )) as GitHubAppOrganizationInstallationDetail;
      return outcome;
    } catch (error) {
      throw error;
    }
  }

  // People

  async removeEnterpriseMember(graphQlUserId: string) {
    const github = this.providers.github;
    const mutation = queries.removeEnterpriseMember;
    try {
      const nodeId = this.requireGraphqlNodeId();
      const result = await github.graphql(this.enterpriseToken, mutation, {
        enterpriseId: nodeId,
        userId: graphQlUserId,
      });
      const login = result?.removeEnterpriseMember?.user?.login;
      if (!login) {
        throw CreateError.NotAuthorized(
          'The specified user was not found in the enterprise, or, this Enterprise App does not have permission to manage members.'
        );
      }
      return login;
    } catch (error) {
      throw error;
    }
  }

  async inviteEnterpriseAdmin(invitee: string): Promise<{ id: string; createdAt: string }> {
    // TODO: role
    // ISSUE: does not work with enterprise-scoped GitHub Apps, only PATs; JWilcox reported.
    const role = 'OWNER'; // or BILLING_MANAGER
    const github = this.providers.github;
    const mutation = queries.inviteEnterpriseAdmin;
    try {
      const nodeId = this.requireGraphqlNodeId();
      const result = await github.graphql(this.enterpriseToken, mutation, {
        enterpriseId: nodeId,
        invitee,
        role,
      });
      const invitation = result?.inviteEnterpriseAdmin;
      if (invitation) {
        return invitation; // id, createdAt
      }
    } catch (error) {
      throw error;
    }
  }

  async updateEnterpriseAdministratorRole(login: string, role?: string): Promise<string> {
    // ISSUE: does not work with enterprise-scoped GitHub Apps, only PATs; JWilcox reported.
    // ISSUE: does not actually meet blog post expectation which says can be used to add or downgrade
    const github = this.providers.github;
    const mutation = queries.updateEnterpriseAdministratorRole;
    try {
      const nodeId = this.requireGraphqlNodeId();
      const result = await github.graphql(this.enterpriseToken, mutation, {
        enterpriseId: nodeId,
        login,
        role: role || 'OWNER',
      });
      return result?.updateEnterpriseAdministratorRole?.message;
    } catch (error) {
      throw error;
    }
  }

  // Organizations

  async createOrganization(
    login: string,
    profileName: string,
    adminLogins: string[],
    billingEmail: string
  ): Promise<{ id: string; login: string; name: string }> {
    const github = this.providers.github;
    const mutation = queries.createEnterpriseOrganization;
    const nodeId = this.requireGraphqlNodeId();
    try {
      const result = await github.graphql(this.enterpriseToken, mutation, {
        enterpriseId: nodeId,
        login,
        profileName,
        adminLogins,
        billingEmail,
      });
      const organization = result?.createEnterpriseOrganization?.organization;
      if (!organization) {
        throw CreateError.InvalidParameters('Organization creation failed or returned no data');
      }
      return organization;
    } catch (error) {
      const asGraphqlError = error as GraphqlResponseError<unknown>;
      if (asGraphqlError?.name === 'GraphqlResponseError') {
        const message = asGraphqlError.message;
        if (message.includes('Organization name is not available')) {
          throw CreateError.Conflict(
            `The organization name "${login}" is not available. Please choose another name.`,
            asGraphqlError
          );
        }
      }
      throw error;
    }
  }

  async getGitHubLoginForUserPrincipalName(userPrincipalName: string): Promise<string> {
    const node = await this.getSamlNodeFromUserPrincipalName(userPrincipalName);
    return node?.user?.login;
  }

  async getSamlNodeFromUserPrincipalName(
    userPrincipalName: string
  ): Promise<EnterpriseSamlExternalIdentityBasics> {
    const github = this.providers.github;
    try {
      const response = await github.graphql(
        this.enterpriseToken,
        queries.getIdentityFromExternal,
        {
          enterpriseName: this.slug,
          userPrincipalName,
        },
        {
          paginate: false,
        }
      );
      const nodes = response?.enterprise?.ownerInfo?.samlIdentityProvider?.externalIdentities
        ?.edges as EnterpriseSamlExternalIdentityNode[];
      if (nodes.length > 0) {
        return nodes[0].node;
      }
    } catch (error) {
      throw error;
    }
  }

  async getSamlUserPrincipalNameForGitHubLogin(login: string): Promise<string> {
    const node = await this.getSamlNodeForGitHubLogin(login);
    return node?.samlIdentity?.nameId;
  }

  async getSamlNodeForGitHubLogin(login: string): Promise<EnterpriseSamlExternalIdentityBasics> {
    const github = this.providers.github;
    try {
      const response = await github.graphql(
        this.enterpriseToken,
        queries.getIdentityFromGitHubLogin,
        {
          enterpriseName: this.slug,
          login,
        },
        {
          paginate: false,
        }
      );
      const nodes = response?.enterprise?.ownerInfo?.samlIdentityProvider?.externalIdentities
        ?.edges as EnterpriseSamlExternalIdentityNode[];
      if (nodes?.length > 0) {
        return nodes[0].node;
      }
    } catch (error) {
      throw error;
    }
  }

  async getSamlMemberExternalIdentities(): Promise<EnterpriseSamlExternalIdentityBasics[]> {
    const fixedFirstFieldsCount = 8;
    const github = this.providers.github;
    try {
      const response = await github.graphql(
        this.enterpriseToken,
        queries.paginate,
        {
          enterpriseName: this.slug,
          // id: this._id,
        },
        {
          paginate: false, // true,
        }
      );
      const nodes = response?.enterprise?.ownerInfo?.samlIdentityProvider?.externalIdentities
        ?.edges as EnterpriseSamlExternalIdentityNode[];
      return nodes.map((node) => node.node);
    } catch (error) {
      throw error;
    }
  }

  async getMember(login: string) {
    const members = await this.getMembers(login);
    if (members?.length > 0) {
      for (const member of members) {
        if (member?.login?.toLowerCase() === login.toLowerCase()) {
          return member;
        }
      }
    }
    throw CreateError.NotFound(
      `Member with login ${login} not found in the ${this.slug} enterprise, or, the enterprise app cannot iterate members.`
    );
  }

  async getMembers(query?: string) {
    const github = this.providers.github;
    try {
      const response = await github.graphql(
        this.enterpriseToken,
        queries.getMembersByAffiliation,
        {
          enterpriseName: this.slug,
          q: query,
        },
        {
          paginate: true,
        }
      );
      const nodes = response?.enterprise?.members?.nodes as EnterpriseMemberBasics[];
      return nodes;
    } catch (error) {
      throw error;
    }
  }

  async getMembersByAffiliation(role: EnterpriseUserAccountMembershipRole, query?: string) {
    if (!role) {
      throw CreateError.InvalidParameters('Role is required');
    }
    if (!ENTERPRISE_ROLES.includes(role)) {
      throw CreateError.InvalidParameters('Invalid role: ' + role);
    }
    const github = this.providers.github;
    try {
      const response = await github.graphql(
        this.enterpriseToken,
        queries.getMembersByAffiliation,
        {
          enterpriseName: this.slug,
          role,
          q: query,
        },
        {
          paginate: true,
        }
      );
      const nodes = response?.enterprise?.members?.nodes as EnterpriseMemberBasics[];
      return nodes;
    } catch (error) {
      throw error;
    }
  }

  private guardFixedAppPurposeRequired() {
    if (!this.options?.fixedPurpose) {
      throw CreateError.InvalidParameters(
        'Cannot create organization instance without a fixed app purpose provided to the enterprise constructor.'
      );
    }
  }

  async installEnterpriseAppOnOrganization(
    orgName: string
  ): Promise<GitHubAppOrganizationInstallationDetail> {
    const lc = orgName.toLowerCase();
    this.guardFixedAppPurposeRequired();
    const purpose = this.options.fixedPurpose;
    let enterpriseAppConfiguration: GitHubAppConfiguration;
    if (isCustomAppPurpose(purpose) && purpose.getForTargetName) {
      enterpriseAppConfiguration = purpose.getForTargetName(this.slug);
    }
    if (!enterpriseAppConfiguration) {
      throw CreateError.InvalidParameters(
        `No defined enterprise configuration is available from the fixed app purpose for "${this.slug}".`
      );
    }
    const clientId = enterpriseAppConfiguration.clientId;
    if (!clientId) {
      throw CreateError.InvalidParameters(
        `No client ID is defined in the enterprise configuration for "${this.slug}" and purpose ${purpose}.`
      );
    }
    const installation = await this.installGitHubAppOnOrganization(orgName, clientId, {
      repository_selection: GitHubAppInstallationRepositoryScope.All,
    });
    this._knownOrgInstallations.set(lc, installation);
    return installation;
  }

  async isEnterpriseAppInstalledOnOrganization(orgName: string): Promise<boolean> {
    this.guardFixedAppPurposeRequired();
    try {
      await this.getOrganizationEnterpriseAppInstallationDetails(orgName);
      return true;
    } catch (error) {
      if (ErrorHelper.IsNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  async getOrganizationEnterpriseAppInstallationDetails(orgName: string) {
    this.guardFixedAppPurposeRequired();
    const lc = orgName.toLowerCase();
    let existing = this._knownOrgInstallations.get(lc);
    if (existing) {
      return existing;
    }
    const purpose = this.options.fixedPurpose;
    if (!isCustomAppPurpose(purpose)) {
      throw CreateError.InvalidParameters(
        'From an enterprise instance, only custom app purposes are supported.'
      );
    }
    let enterpriseAppConfiguration: GitHubAppConfiguration;
    if (purpose.getForTargetName) {
      enterpriseAppConfiguration = purpose.getForTargetName(this.slug);
    }
    if (!enterpriseAppConfiguration) {
      throw CreateError.InvalidParameters(
        `No defined enterprise configuration is available from the fixed app purpose for "${this.slug}".`
      );
    }
    let instance: GitHubApplication;
    if (isCustomAppPurposeWithGetAppInstance(purpose)) {
      instance = purpose.getGitHubAppInstance();
    } else if (isCustomAppPurposeWithGetTargetedAppInstance(purpose)) {
      instance = purpose.getGitHubAppInstanceForTargetName(this.slug);
    } else {
      throw CreateError.InvalidParameters(
        'Cannot resolve GitHub Application instance from the provided app purpose. No appropriate helper methods.'
      );
    }
    try {
      existing = await instance.getInstallationForOrganization(orgName);
      this._knownOrgInstallations.set(lc, existing);
    } catch (error) {
      if (ErrorHelper.IsNotFound(error)) {
        throw CreateError.NotFound(
          `The GitHub App "${instance.slug}" is not installed on the "${orgName}" organization in the "${this.slug}" enterprise, or, the organization does not exist in the enterprise.`
        );
      }
      throw ErrorHelper.WrapError(
        error,
        `Could not get installation details for the GitHub App "${instance.slug}" on the "${orgName}" organization in the "${this.slug}" enterprise: ${error.message}`
      );
    }
    return existing;
  }

  async getOrganization(orgName: string) {
    const lc = orgName.toLowerCase();
    if (this._invisibleOrganizations.has(lc)) {
      return this._invisibleOrganizations.get(lc);
    }
    // Support using the enterprise token directly for org operations
    if (this.options?.useEnterpriseTokenForOrganizations) {
      if (!isStringToken(this.enterpriseToken)) {
        throw CreateError.InvalidParameters(
          'useEnterpriseTokenForOrganizations requires a string token in the enterprise constructor.'
        );
      }
      // Strip "token " prefix since CreateEmptyWithOldToken expects raw token
      // (getAuthorizationHeader in operations will add it back)
      const rawToken = this.enterpriseToken.replace(/^token\s+/i, '');
      const orgSettings = OrganizationSetting.CreateEmptyWithOldToken(
        rawToken,
        `${orgName} in ${this.slug} enterprise (enterprise token)`
      );
      orgSettings.active = true;
      orgSettings.features.push(OrganizationFeature.Invisible);
      const invisibleOrgOptions: GetInvisibleOrganizationOptions = {
        requireExplicitSettings: true,
        settings: orgSettings,
        authenticationType: GitHubAppAuthenticationType.BestAvailable,
        storeInstanceByName: false,
      };
      const { operations } = this.providers;
      const org = operations.getInvisibleOrganization(orgName, invisibleOrgOptions);
      this._invisibleOrganizations.set(lc, org);
      return org;
    }
    const installation = await this.getOrganizationEnterpriseAppInstallationDetails(orgName);
    const install: AppAndInstallationIds = {
      appId: installation.app_id,
      installationId: installation.id,
    };
    const orgSettings = new OrganizationSetting();
    orgSettings.organizationId = installation.account.id;
    const purpose = this.options.fixedPurpose;
    const appPurposeId = getAppPurposeId(purpose);
    orgSettings.active = true;
    orgSettings.operationsNotes = `${orgName} in ${this.slug} enterprise (${appPurposeId})`;
    orgSettings.features.push(OrganizationFeature.Invisible);
    orgSettings.installations.push({
      ...install,
      appPurposeId,
    });
    const invisibleOrgOptions: GetInvisibleOrganizationOptions = {
      requireExplicitSettings: true,
      settings: orgSettings,
      authenticationType: GitHubAppAuthenticationType.ForceSpecificInstallation,
      storeInstanceByName: false, // don't keep this around in Operations
    };
    const { operations } = this.providers;
    const org = operations.getInvisibleOrganization(orgName, invisibleOrgOptions);
    this._invisibleOrganizations.set(lc, org);
    return org;
  }

  async getOrganizations(): Promise<EnterpriseOrganizationBasics[]> {
    const github = this.providers.github;
    try {
      const response = await github.graphql(
        this.enterpriseToken,
        queries.getOrganizations,
        {
          enterpriseName: this.slug,
        },
        {
          paginate: true,
        }
      );
      const nodes = response?.enterprise?.organizations?.nodes as EnterpriseOrganizationBasics[];
      return nodes;
    } catch (error) {
      throw error;
    }
  }
}

const queries = {
  createEnterpriseOrganization: `
    mutation createEnterpriseOrganization($enterpriseId: ID!, $login: String!, $profileName: String!, $adminLogins: [String!]!, $billingEmail: String!) {
      createEnterpriseOrganization(input: {
        enterpriseId: $enterpriseId,
        login: $login,
        profileName: $profileName,
        adminLogins: $adminLogins,
        billingEmail: $billingEmail
      }) {
        organization {
          id
          login
          name
        }
      }
    }
  `,
  removeEnterpriseMember: `
    mutation removeEnterpriseMember($enterpriseId:ID!, $userId:ID!) {
      removeEnterpriseMember(input:{
        enterpriseId:$enterpriseId,
        userId:$userId
      }) {
        user {
          login
        }
      }
    }
  `,
  inviteEnterpriseAdmin: `
    mutation inviteEnterpriseAdmin($enterpriseId:ID!, $invitee:String!, $role:EnterpriseAdministratorRole!) {
      inviteEnterpriseAdmin(input:{
        enterpriseId:$enterpriseId,
        invitee:$invitee,
        role:$role
      }) {
        invitation {
          createdAt
          id
        }
      }
    }
  `,
  updateEnterpriseAdministratorRole: `
    mutation updateEnterpriseAdministratorRole($enterpriseId:ID!, $login:String!, $role:EnterpriseAdministratorRole!) {
      updateEnterpriseAdministratorRole(input:{
        enterpriseId:$enterpriseId,
        login:$login,
        role:$role
      }) {
        message
      }
    }
  `,
  getEnterprise: `
    query getEnterprise($enterpriseName: String!) {
      enterprise(slug: $enterpriseName) {
        id
        name
        slug
      }
    }
  `,
  getEnterpriseDetails: `
    query getEnterpriseDetails($enterpriseName: String!) {
      enterprise(slug: $enterpriseName) {
        avatarUrl
        billingEmail
        createdAt
        description
        id
        location
        name
        readme
        resourcePath
        slug
        updatedAt
        url
        websiteUrl
      }
    }
  `,
  getOrganizations: `
    query getOrganizations($enterpriseName: String!, $cursor: String) {
      enterprise(slug: $enterpriseName) {
        organizations(first: 100, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            name
            login
            viewerCanAdminister
          }
        }
      }
    }
  `,
  getMembersByAffiliation: `
    query getMembersByAffiliation($enterpriseName: String!, $role: EnterpriseUserAccountMembershipRole, $q: String, $cursor: String) {
      enterprise(slug: $enterpriseName) {
        members(first: 100, after: $cursor, role: $role, query: $q) {
          totalCount
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            __typename
            ... on User {
              id
              login
            }
            ... on EnterpriseUserAccount {
              id
              login
            }
          }
        }
      }
    }
  `,
  getIdentityFromGitHubLogin: `
    query getIdentity($enterpriseName: String!, $login: String!) {
      enterprise(slug: $enterpriseName) {
        ownerInfo {
          samlIdentityProvider {
            externalIdentities(first: 5, login: $login) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  user {
                    login
                  }
                  samlIdentity {
                    nameId
                  }
                }
              }
            }
          }
        }
      }
    }
  `,
  getIdentityFromExternal: `
    query getIdentity($enterpriseName: String!, $userPrincipalName: String!) {
      enterprise(slug: $enterpriseName) {
        ownerInfo {
          samlIdentityProvider {
            externalIdentities(first: 5, userName: $userPrincipalName) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  user {
                    login
                  }
                  samlIdentity {
                    nameId
                  }
                }
              }
            }
          }
        }
      }
    }
  `,
  paginate: `
    query paginate($cursor: String, $enterpriseName: String!) {
      enterprise(slug: $enterpriseName) {
        ownerInfo {
          samlIdentityProvider {
            externalIdentities(after: $cursor, first: 100) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  user {
                    login
                  }
                  samlIdentity {
                    nameId
                  }
                }
              }
            }
          }
        }
      }
    }
  `,
};
