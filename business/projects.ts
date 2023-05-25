//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { AppPurpose, AppPurposeTypes } from './githubApps';
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
import { OrganizationProject } from './project';

type ProjectResponse = {
  id: string;
  title: string;
};

type ProjectsListIteratorResponse = {
  organization: {
    projectsV2: IteratorResponse<ProjectResponse>;
  };
};

export class OrganizationProjects {
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

  get(projectNodeId: string) {
    return new OrganizationProject(
      this,
      this._operations,
      this._getAuthorizationHeader,
      this._getSpecificAuthorizationHeader,
      projectNodeId
    );
  }

  async create(title: string): Promise<any> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const ownerId = await this._organization.getGraphQlNodeId();
    const mutation = `
      mutation createProject($ownerId:ID!, $title:String!) {
        createProjectV2(input:{
          ownerId:$ownerId,
          title:$title
        }) {
          projectV2 {
            id
          }
        }
      }
    `;
    try {
      const result = await operations.github.graphql(this.authorize(), mutation, {
        ownerId,
        title,
      });
      return result;
    } catch (error) {
      throw error;
    }
  }

  async getAll(): Promise<any> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const pageSize = DefaultGraphqlPageSize;
    try {
      const result = await operations.github.graphql(
        this.authorize(),
        query.all(pageSize),
        {
          login: this._organization.name,
        },
        {
          paginate: true,
        }
      );
      return result?.organization?.projectsV2?.nodes;
    } catch (error) {
      throw error;
    }
  }

  async iterate(
    options: PaginationPageSizeOptions = { pageSize: DefaultGraphqlPageSize }
  ): Promise<AsyncIterable<ProjectsListIteratorResponse> & IteratorPickerResponse<ProjectResponse>> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const pageSize = options?.pageSize || DefaultGraphqlPageSize;
    try {
      const result = (await operations.github.graphqlIteration(this.authorize(), query.all(pageSize), {
        login: this._organization.name,
      })) as AsyncIterable<ProjectsListIteratorResponse>;
      return decorateIterable<ProjectResponse, ProjectsListIteratorResponse>(
        result,
        'organization.projectsV2'
      );
    } catch (error) {
      throw error;
    }
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

const query = {
  all: (pageSize: number) => `
    query paginate($cursor: String, $login: String!) {
      organization(login: $login) {
        projectsV2(first: ${pageSize}, after: $cursor) {
          nodes {
            id
            title
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
