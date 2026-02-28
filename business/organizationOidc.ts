//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Organization } from './organization.js';
import { Operations, symbolizeApiResponse } from './index.js';
import { AppPurpose } from '../lib/github/appPurposes.js';

import type { PurposefulGetAuthorizationHeader, GetAuthorizationHeader } from '../interfaces/index.js';
import type { GitHubOidcClaimKey } from './repositoryOidc.js';

const OIDC_CUSTOMIZATION_ROUTE = '/orgs/:org/actions/oidc/customization/sub';

export type GitHubActionsOrgOidcCustomization = {
  include_claim_keys: GitHubOidcClaimKey[];
};

export class OrganizationOidc {
  private _organization: Organization;
  private _getAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _operations: Operations;

  constructor(
    organization: Organization,
    getAuthorizationHeader: PurposefulGetAuthorizationHeader,
    operations: Operations
  ) {
    this._organization = organization;
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._operations = operations;
  }

  async getCustomization(): Promise<GitHubActionsOrgOidcCustomization> {
    const operations = this._operations as Operations;
    const { github } = operations;
    const parameters = {
      org: this._organization.name,
    };
    const requirements = github.createRequirementsForRequest(
      this.authorize(AppPurpose.Operations),
      `GET ${OIDC_CUSTOMIZATION_ROUTE}`,
      {
        permissions: {
          permission: 'organization_administration',
          access: 'read',
        },
        permissionsMatchRequired: true,
      }
    );
    const response = (await github.requestWithRequirements(
      requirements,
      parameters
    )) as GitHubActionsOrgOidcCustomization;
    return symbolizeApiResponse(response);
  }

  async setCustomization(customization: GitHubActionsOrgOidcCustomization): Promise<void> {
    const payload = customization || {};
    const operations = this._operations as Operations;
    const { github } = operations;
    const parameters = {
      org: this._organization.name,
      ...payload,
    };
    const requirements = github.createRequirementsForRequest(
      this.authorize(AppPurpose.Operations),
      `PUT ${OIDC_CUSTOMIZATION_ROUTE}`,
      {
        permissions: {
          permission: 'organization_administration',
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
