//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { OrganizationSetting } from './entities/organizationSettings/organizationSetting.js';
import { GetAuthorizationHeader, IGitHubAppInstallation, ICacheOptions } from '../interfaces/index.js';
import { wrapError } from '../lib/utils.js';
import { Operations } from './operations/index.js';
import { GitHubTokenManager } from '../lib/github/tokenManager.js';

import type { GetAwaitedString } from '../lib/github/appPurposes.js';

const primaryInstallationProperties = [
  'id',
  'account',
  'app_id',
  'target_id',
  'target_type',
  'permissions',
  'events',
];

export type GitHubAppDefinition = {
  id: number;
  slug: string;
  friendlyName: string;
};

export function isInstallationConfigured(
  settings: OrganizationSetting,
  installation: IGitHubAppInstallation
): boolean {
  if (!settings || !settings.installations) {
    return false;
  }
  for (const install of settings.installations) {
    if (install.installationId === installation.id) {
      return true;
    }
  }
  return false;
}

export default class GitHubApplication {
  constructor(
    private operations: Operations,
    public id: number,
    public slug: string,
    public friendlyName: string,
    public getCertificateSha256: GetAwaitedString,
    private getAuthorizationHeader: GetAuthorizationHeader
  ) {}

  static PrimaryInstallationProperties = primaryInstallationProperties;

  static filterInstallations(installations: IGitHubAppInstallation[]) {
    return {
      valid: installations.filter((install) => GitHubApplication.isInvalidInstallation(install).length === 0),
      invalid: installations.filter((install) => GitHubApplication.isInvalidInstallation(install).length > 0),
    };
  }

  static isInvalidInstallation(installation: IGitHubAppInstallation): string[] /* invalid reasons*/ {
    const invalid: string[] = [];
    if (installation.target_type !== 'Organization') {
      invalid.push(`Installation has an unsupported target type of ${installation.target_type}.`);
    }
    // CONSIDER: this is useful to warn about, but to allow same-app repo-scope...
    // if (installation.repository_selection && installation.repository_selection !== 'all') {
    //   invalid.push(`This app can only be installed at the organization scope (all repos), please update the settings for the installation.`);
    // }
    return invalid;
  }

  asClientJson(): GitHubAppDefinition {
    return {
      id: this.id,
      slug: this.slug,
      friendlyName: this.friendlyName,
    };
  }

  async getInstallation(installationId: number, options?: ICacheOptions): Promise<IGitHubAppInstallation> {
    const operations = this.operations;
    const parameters = {
      installation_id: installationId.toString(),
    };
    const cacheOptions = { ...options };
    const github = operations.github;
    const { rest } = github.octokit;
    try {
      const entity = await operations.github.callWithRequirements(
        github.createRequirementsForFunction(
          this.authorize(),
          rest.apps.getInstallation,
          'apps.getInstallation'
        ),
        parameters,
        cacheOptions
      );
      return entity as IGitHubAppInstallation;
    } catch (error) {
      // TODO: 404 vs error
      throw wrapError(
        error,
        `Could not get details about the ${this.id} app installation ID ${installationId}: ${error.message}`
      );
    }
  }

  async getInstallationForOrganization(
    organizationName: string,
    options?: ICacheOptions
  ): Promise<IGitHubAppInstallation> {
    const operations = this.operations;
    const parameters = {
      org: organizationName,
    };
    const cacheOptions = { ...options };
    const github = operations.github;
    const { rest } = github.octokit;
    try {
      const entity = await operations.github.callWithRequirements(
        github.createRequirementsForFunction(
          this.authorize(),
          rest.apps.getOrgInstallation,
          'apps.getOrgInstallation'
        ),
        parameters,
        cacheOptions
      );
      return entity as IGitHubAppInstallation;
    } catch (error) {
      throw wrapError(
        error,
        `Could not get installation for app ${this.id} in organization ${organizationName}: ${error.message}`
      );
    }
  }

  async deleteInstallation(installationId: number): Promise<void> {
    const parameters = {
      installation_id: installationId.toString(),
    };
    await this.operations.github.post(this.authorize(), 'apps.deleteInstallation', parameters);
  }

  async getInstallations(options?: ICacheOptions): Promise<IGitHubAppInstallation[]> {
    options = options || {};
    const operations = this.operations;
    const getAuthorizationHeader = this.getAuthorizationHeader.bind(this) as GetAuthorizationHeader;
    const github = operations.github;
    const caching = {
      maxAgeSeconds: options.maxAgeSeconds || operations.defaults.orgRepoDetailsStaleSeconds, // borrowing from another value
      backgroundRefresh: false,
      // pageRequestDelay: options.pageRequestDelay,
    };
    const { rest } = github.octokit;
    const installations = await github.collections.collectAllPagesWithRequirements<any, any>(
      'appInstallations',
      github.createRequirementsForFunction(
        getAuthorizationHeader,
        rest.apps.listInstallations,
        'apps.listInstallations'
      ),
      {
        app_id: this.id.toString(),
        per_page: 100,
      },
      caching
    );
    return installations;
  }

  async getInstallationRateLimit(operations: Operations, organizationName: string, installationId: number) {
    const tokenManager = GitHubTokenManager.TryGetTokenManagerForOperations(operations);
    return await tokenManager.getInstallationRateLimitInformation(
      operations,
      organizationName,
      this.id,
      installationId
    );
  }

  private authorize(): GetAuthorizationHeader | string {
    const getAuthorizationHeader = this.getAuthorizationHeader.bind(this) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}
