//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from './repository.js';
import { Operations, symbolizeApiResponse } from './index.js';
import { AppPurpose } from '../lib/github/appPurposes.js';

import type { PurposefulGetAuthorizationHeader, GetAuthorizationHeader } from '../interfaces/index.js';

const OIDC_CUSTOMIZATION_ROUTE = '/repos/:owner/:repo/actions/oidc/customization/sub';

// Based on documentation as of 2025-11-19 at https://docs.github.com/en/enterprise-cloud@latest/actions/concepts/security/openid-connect
export type GitHubOidcClaimKey =
  | 'jti'
  | 'sub'
  | 'environment'
  | 'aud'
  | 'ref'
  | 'sha'
  | 'context'
  | 'repository'
  | 'repository_owner'
  | 'actor_id'
  | 'repository_visibility'
  | 'repository_id'
  | 'repository_owner_id'
  | 'run_id'
  | 'run_number'
  | 'run_attempt'
  | 'runner_environment'
  | 'actor'
  | 'workflow'
  | 'head_ref'
  | 'base_ref'
  | 'event_name'
  | 'enterprise'
  | 'enterprise_id'
  | 'ref_type'
  | 'job_workflow_ref'
  | 'iss'
  | 'nbf'
  | 'exp'
  | 'iat';

export type GitHubActionsOidcCustomization = {
  use_default: boolean;
  include_claim_keys: GitHubOidcClaimKey[];
};

export class RepositoryOidc {
  private _repository: Repository;
  private _getAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _operations: Operations;

  constructor(
    repository: Repository,
    getAuthorizationHeader: PurposefulGetAuthorizationHeader,
    operations: Operations
  ) {
    this._repository = repository;
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._operations = operations;
  }

  async getCustomization(): Promise<GitHubActionsOidcCustomization> {
    const operations = this._operations as Operations;
    const { github } = operations;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
    };
    const requirements = github.createRequirementsForRequest(
      this.authorize(AppPurpose.Security),
      `GET ${OIDC_CUSTOMIZATION_ROUTE}`,
      {
        permissions: {
          permission: 'actions',
          access: 'read',
        },
      }
    );
    const response = (await github.requestWithRequirements(
      requirements,
      parameters
    )) as GitHubActionsOidcCustomization;
    return symbolizeApiResponse(response);
  }

  async setCustomization(customization: GitHubActionsOidcCustomization): Promise<void> {
    const payload = customization || {};
    const operations = this._operations as Operations;
    const { github } = operations;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
      ...payload,
    };
    const requirements = github.createRequirementsForRequest(
      this.authorize(AppPurpose.Updates),
      `PUT ${OIDC_CUSTOMIZATION_ROUTE}`,
      {
        permissions: {
          permission: 'actions',
          access: 'write',
        },
        permissionsMatchRequired: true,
        allowBestFaithInstallationForAnyHttpMethod: true,
      }
    );
    await github.requestAsPostWithRequirements(requirements, parameters);
  }

  private authorize(purpose: AppPurpose): GetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(this, purpose) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}
