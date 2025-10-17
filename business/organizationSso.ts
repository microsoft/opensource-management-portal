//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import {
  EnhancedPagedCacheOptions,
  GetAuthorizationHeader,
  PurposefulGetAuthorizationHeader,
} from '../interfaces/index.js';
import { AppPurpose } from '../lib/github/appPurposes.js';
import { CacheDefault, getMaxAgeSeconds, getPageSize, Operations } from './operations/core.js';
import { Organization } from './organization.js';

export type OrganizationSamlAuthorizationsOptions = EnhancedPagedCacheOptions & {
  login?: string;
};

type SamlAuthorizationParameters = {
  org: string;
  per_page?: number;
  login?: string;
};

const samlPropertiesToCopy = [
  'login',
  'credential_id', // Unique identifier for the authorization of the credential. Use this to revoke authorization of the underlying token or key.
  'credential_type',
  'token_last_eight',
  'credential_authorized_at',
  'credential_accessed_at',
  'authorized_credential_expires_at',
  'scopes',
  'fingerprint',
  'authorized_credential_id',
  'authorized_credential_note',
];

export type SamlAuthorization = {
  login: string;
  credential_id: string;
  credential_type: string; // Human-readable description of the credential type
  token_last_eight: string; // Only included in responses with credential_type of personal access token
  credential_authorized_at: string;
  credential_accessed_at: string; // Date when the credential was last accessed. May be null if it was never accessed"
  authorized_credential_expires_at: string;
  scopes: string[];
  fingerprint: string; // Unique string to distinguish the credential. Only included in responses with credential_type of SSH Key.
  authorized_credential_id: number; // The ID of the underlying token that was authorized by the user. This will remain unchanged across authorizations of the token.
  authorized_credential_title: string; // The title given to the ssh key. This will only be present when the credential is an ssh key.
  authorized_credential_note: string; // The note given to the token. This will only be present when the credential is a token.
};

export class OrganizationSingleSignOn {
  constructor(
    private organization: Organization,
    private getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader,
    private getAuthorizationHeader: PurposefulGetAuthorizationHeader,
    private operations: Operations
  ) {}

  async getSamlAuthorizations(options?: OrganizationSamlAuthorizationsOptions): Promise<SamlAuthorization[]> {
    options = options || {};
    const operations = this.operations as Operations;
    const github = operations.github;
    const perPage = options.perPage || getPageSize(operations);
    if (options.perPage) {
      delete options.perPage;
    }
    const parameters: SamlAuthorizationParameters = {
      org: this.organization.name,
      per_page: perPage,
    };
    if (options.login) {
      parameters.login = options.login;
    }
    const caching = {
      maxAgeSeconds: getMaxAgeSeconds(operations as Operations, CacheDefault.orgMembersStaleSeconds, options),
      backgroundRefresh: true,
      pageRequestDelay: options.pageRequestDelay,
    };
    if (options && options.backgroundRefresh === false) {
      caching.backgroundRefresh = false;
    }
    const authorizations = await github.collections.collectAllPagesViaHttpGetWithRequirements<
      SamlAuthorizationParameters,
      SamlAuthorization
    >(
      'saml',
      github.createRequirementsForRequest(
        this.authorize(AppPurpose.Data),
        `GET /orgs/${this.organization.name}/credential-authorizations`,
        {
          permissions: {
            permission: 'organization_administration',
            access: 'read',
          },
        }
      ),
      parameters,
      caching,
      samlPropertiesToCopy
      // no reducer property
    );
    return authorizations;
  }

  private authorize(purpose: AppPurpose): GetAuthorizationHeader {
    const getAuthorizationHeader = this.getAuthorizationHeader.bind(this, purpose) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}
