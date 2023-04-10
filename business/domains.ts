//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { AppPurpose, AppPurposeTypes } from '../github';
import { Organization } from '.';
import {
  IOperationsInstance,
  IPurposefulGetAuthorizationHeader,
  throwIfNotGitHubCapable,
  IGetAuthorizationHeader,
} from '../interfaces';
import {
  decorateIterable,
  IteratorPickerResponse,
  IteratorResponse,
  PaginationPageSizeOptions,
} from './iterable';
import { DefaultGraphqlPageSize } from '../transitional';

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

  private _getAuthorizationHeader: IPurposefulGetAuthorizationHeader;
  private _getSpecificAuthorizationHeader: IPurposefulGetAuthorizationHeader;
  private _purpose: AppPurpose;

  constructor(
    organization: Organization,
    operations: IOperationsInstance,
    getAuthorizationHeader: IPurposefulGetAuthorizationHeader,
    getSpecificAuthorizationHeader: IPurposefulGetAuthorizationHeader
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
  }

  async iterate(
    options: PaginationPageSizeOptions = { pageSize: DefaultGraphqlPageSize }
  ): Promise<AsyncIterable<DomainsListIteratorResponse> & IteratorPickerResponse<DomainResponse>> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const pageSize = options?.pageSize || DefaultGraphqlPageSize;
    const result = (await operations.github.graphqlIteration(this.authorize(), domainQueries.all(pageSize), {
      login: this._organization.name,
    })) as AsyncIterable<DomainsListIteratorResponse>;
    return decorateIterable<DomainResponse, DomainsListIteratorResponse>(result, 'organization.domains');
  }

  private authorize(purpose: AppPurpose = this._purpose): IGetAuthorizationHeader {
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(
      this,
      purpose
    ) as IGetAuthorizationHeader;
    return getAuthorizationHeader;
  }

  private authorizeSpecificPurpose(purpose: AppPurposeTypes): IGetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getSpecificAuthorizationHeader.bind(
      this,
      purpose
    ) as IGetAuthorizationHeader;
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
