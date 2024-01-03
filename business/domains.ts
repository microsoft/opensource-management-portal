//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { AppPurpose, AppPurposeTypes } from '../lib/github/appPurposes';
import { Organization } from '.';
import {
  IOperationsInstance,
  PurposefulGetAuthorizationHeader,
  throwIfNotGitHubCapable,
  GetAuthorizationHeader,
} from '../interfaces';
import {
  decorateIterable,
  IteratorPickerResponse,
  IteratorResponse,
  PaginationPageSizeOptions,
} from './iterable';
import { DefaultGraphqlPageSize } from '../lib/transitional';

type DomainResponse = {
  id: string;
  createdAt: string;
  dnsHostName: string;
  domain: string;
  hasFoundHostName: boolean;
  hasFoundVerificationToken: boolean;
  isApproved: boolean;
  isRequiredForPolicyEnforcement: boolean;
  isVerified: boolean;
  owner: string;
  punycodeEncodedDomain: string;
  updatedAt: string;
};

type DomainsListIteratorResponse = {
  organization: {
    domains: IteratorResponse<DomainResponse>;
  };
};

export class OrganizationDomains {
  private _organization: Organization;
  private _operations: IOperationsInstance;

  private _getAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _purpose: AppPurpose;

  constructor(
    organization: Organization,
    operations: IOperationsInstance,
    getAuthorizationHeader: PurposefulGetAuthorizationHeader,
    getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader
  ) {
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._getSpecificAuthorizationHeader = getSpecificAuthorizationHeader;
    this._organization = organization;
    this._operations = operations;
    this._purpose = AppPurpose.Operations;
  }

  overrideDefaultAppPurpose(purpose: AppPurpose) {
    this._purpose = purpose;
  }

  get organization(): Organization {
    return this._organization;
  }

  // get: not implemented, see projects.ts for similar pattern

  async getAll(): Promise<any> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const pageSize = DefaultGraphqlPageSize;
    try {
      const result = await operations.github.graphql(
        this.authorize(),
        domainQueries.all(pageSize),
        {
          login: this._organization.name,
        },
        {
          paginate: true,
        }
      );
      return result?.organization?.domains?.nodes;
    } catch (error) {
      throw error;
    }
  }

  async iterate(
    options: PaginationPageSizeOptions = { pageSize: DefaultGraphqlPageSize }
  ): Promise<AsyncIterable<DomainsListIteratorResponse> & IteratorPickerResponse<DomainResponse>> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const pageSize = options?.pageSize || DefaultGraphqlPageSize;
    try {
      const result = (await operations.github.graphqlIteration(
        this.authorize(),
        domainQueries.all(pageSize),
        {
          login: this._organization.name,
        }
      )) as AsyncIterable<DomainsListIteratorResponse>;
      return decorateIterable<DomainResponse, DomainsListIteratorResponse>(result, 'organization.domains');
    } catch (error) {
      throw error;
    }
  }

  private authorize(purpose: AppPurpose = this._purpose): GetAuthorizationHeader {
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(this, purpose) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }

  private authorizeSpecificPurpose(purpose: AppPurposeTypes): GetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getSpecificAuthorizationHeader.bind(
      this,
      purpose
    ) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}

const domainQueries = {
  all: (pageSize: number) => `
    query paginate($cursor: String, $login: String!) {
      organization(login: $login) {
        domains(first: ${pageSize}, after: $cursor) {
          nodes {
            id
            createdAt
            dnsHostName
            domain
            hasFoundHostName
            hasFoundVerificationToken
            isApproved
            isRequiredForPolicyEnforcement
            isVerified
            owner
            punycodeEncodedDomain
            updatedAt
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `,
};
