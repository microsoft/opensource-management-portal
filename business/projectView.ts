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
import { OrganizationProject, ProjectViewEssentials } from './project';

type ProjectViewDetails = {
  id: string;
  title: string;
  number: number;
};

export class OrganizationProjectView {
  private _project: OrganizationProject;
  private _operations: IOperationsInstance;

  private _getAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _purpose: AppPurpose;

  private _id: string;
  private _essentials: ProjectViewEssentials;
  private _details: ProjectViewDetails;

  constructor(
    organizationProject: OrganizationProject,
    operations: IOperationsInstance,
    getAuthorizationHeader: PurposefulGetAuthorizationHeader,
    getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader,
    projectId: string,
    essentials?: ProjectViewEssentials
  ) {
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._getSpecificAuthorizationHeader = getSpecificAuthorizationHeader;
    this._project = organizationProject;
    this._operations = operations;
    this._purpose = AppPurpose.Operations;
    this._id = projectId;
    this._essentials = essentials;
  }

  overrideDefaultAppPurpose(purpose: AppPurpose) {
    this._purpose = purpose;
  }

  get organization(): Organization {
    return this._project.organization;
  }

  get project(): OrganizationProject {
    return this._project;
  }

  async getDetails(): Promise<ProjectViewDetails> {
    const operations = throwIfNotGitHubCapable(this._operations);
    try {
      const result = await operations.github.graphql(
        this.authorize(),
        `
          query projectViewInformation($id: ID!) {
            node(id: $id) {
              ... on ProjectV2View {
                createdAt
                filter
                layout
                name
                number
                updatedAt
              }
            }
          }
      `,
        {
          id: this._id,
        }
      );
      /*
                fields: the visible fields
                groupByFields
                sortByFields
                verticalGroupByFields
      */
      return result?.node as ProjectViewDetails;
    } catch (error) {
      throw error;
    }
  }

  // async getFields(
  //   options: PaginationPageSizeOptions = { pageSize: DefaultGraphqlPageSize }
  // ): Promise<ProjectFieldEssentials[]> {
  //   const operations = throwIfNotGitHubCapable(this._operations);
  //   const pageSize = options?.pageSize || DefaultGraphqlPageSize;
  //   try {
  //     const result = await operations.github.graphql(
  //       this.authorize(),
  //       query.getFields(pageSize),
  //       {
  //         id: this._id,
  //       },
  //       {
  //         paginate: true,
  //       }
  //     );
  //     return result?.node?.fields?.nodes as ProjectFieldEssentials[];
  //   } catch (error) {
  //     throw error;
  //   }
  // }

  // async getFieldsIterator(
  //   options: PaginationPageSizeOptions = { pageSize: DefaultGraphqlPageSize }
  // ): Promise<AsyncIterable<ProjectFieldsIteratorResponse> & IteratorPickerResponse<ProjectFieldEssentials>> {
  //   const operations = throwIfNotGitHubCapable(this._operations);
  //   const pageSize = options?.pageSize || DefaultGraphqlPageSize;
  //   try {
  //     const result = (await operations.github.graphqlIteration(
  //       this.authorize(this._purpose),
  //       query.getFields(pageSize),
  //       {
  //         id: this._id,
  //       }
  //     )) as AsyncIterable<ProjectFieldsIteratorResponse>;
  //     return decorateIterable<ProjectFieldEssentials, ProjectFieldsIteratorResponse>(result, 'node.fields');
  //   } catch (error) {
  //     throw error;
  //   }
  // }

  // async getViews(): Promise<ProjectViewEssentials[]> {
  //   const operations = throwIfNotGitHubCapable(this._operations);
  //   try {
  //     const response = await operations.github.graphql(
  //       this.authorize(),
  //       query.getViews,
  //       {
  //         id: this._id,
  //       },
  //       {
  //         paginate: true,
  //       }
  //     );
  //     return response?.node?.views?.nodes as ProjectViewEssentials[];
  //   } catch (error) {
  //     throw error;
  //   }
  // }

  // async getViewsIterator(): Promise<
  //   AsyncIterable<ProjectViewsIteratorResponse> & IteratorPickerResponse<ProjectViewEssentials>
  // > {
  //   const operations = throwIfNotGitHubCapable(this._operations);
  //   try {
  //     const result = (await operations.github.graphqlIteration(
  //       this.authorize(this._purpose),
  //       query.getViews,
  //       {
  //         id: this._id,
  //       }
  //     )) as AsyncIterable<ProjectFieldsIteratorResponse>;
  //     return decorateIterable<ProjectViewEssentials, ProjectViewsIteratorResponse>(result, 'node.views');
  //   } catch (error) {
  //     throw error;
  //   }
  // }

  // async getItems(): Promise<ProjectItemEssentials[]> {
  //   const operations = throwIfNotGitHubCapable(this._operations);
  //   try {
  //     const response = await operations.github.graphql(
  //       this.authorize(),
  //       query.getItems,
  //       {
  //         id: this._id,
  //       },
  //       {
  //         paginate: true,
  //       }
  //     );
  //     return response?.node?.items?.nodes as ProjectItemEssentials[];
  //   } catch (error) {
  //     throw error;
  //   }
  // }

  // async getItemsIterator(): Promise<
  //   AsyncIterable<ProjectItemsIteratorResponse> & IteratorPickerResponse<ProjectItemEssentials>
  // > {
  //   const operations = throwIfNotGitHubCapable(this._operations);
  //   try {
  //     const result = (await operations.github.graphqlIteration(
  //       this.authorize(this._purpose),
  //       query.getItems,
  //       {
  //         id: this._id,
  //       }
  //     )) as AsyncIterable<ProjectItemsIteratorResponse>;
  //     return decorateIterable<ProjectItemEssentials, ProjectItemsIteratorResponse>(result, 'node.items');
  //   } catch (error) {
  //     throw error;
  //   }
  // }

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

const query = {
  getItems: `
    query paginate($cursor: String, $id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          items(first: 10, after: $cursor) {
            nodes {
              id
              content {
                ... on DraftIssue {
                  title
                  body
                }
                ... on Issue {
                  title
                }
                ... on PullRequest {
                  title
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `,
  getViews: `
    query paginate($cursor: String, $id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          views(first: 10, after: $cursor) {
            nodes {
              ... on ProjectV2View {
                id
                name
                number
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `,
  getFields: (pageSize: number) => `
    query paginate($cursor: String, $id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          fields(first: ${pageSize}, after: $cursor) {
            nodes {
              ... on ProjectV2Field {
                id
                name
              }
              ... on ProjectV2IterationField {
                id  
                name
                configuration {
                  iterations {
                    startDate
                    id
                  }
                }
              }
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `,
};
