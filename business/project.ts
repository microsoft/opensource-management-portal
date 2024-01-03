//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { AppPurpose, AppPurposeTypes } from '../lib/github/appPurposes';
import { Organization, Repository } from '.';
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
import { CreateError, DefaultGraphqlPageSize } from '../lib/transitional';
import { OrganizationProjects } from './projects';
import { OrganizationProjectView } from './projectView';

const enableCloneProjectApi = 'memex_copy_project';

type ProjectFieldsIteratorResponse = {
  node: {
    fields: {
      nodes: IteratorResponse<ProjectFieldEssentials>;
    };
  };
};

type ProjectViewsIteratorResponse = {
  node: {
    views: {
      nodes: IteratorResponse<ProjectViewEssentials>;
    };
  };
};

type ProjectItemsIteratorResponse = {
  node: {
    items: {
      nodes: IteratorResponse<ProjectItemEssentials>;
    };
  };
};

export type ProjectItemEssentials = {
  id: string;
  content?: {
    title: string;
    body?: string;
  };
  fieldValues: ProjectItemFieldValues;
};

export type ProjectItemFieldValues = {
  nodes: ProjectFieldValue[];
};

export type ProjectFieldValue = {
  text?: string;
  date?: string;
  name?: string;
  optionId?: string;
  field: ProjectNamedNode;
};

export type ProjectNamedNode = {
  id: string;
  name: string;
};

export type ProjectFieldEssentials = ProjectNamedNode & {
  options?: ProjectNamedNode[];
};

export type ProjectViewEssentials = ProjectNamedNode & {
  number: number;
};

type ProjectGetItemsOptions = {
  includeFields?: boolean;
};

type ProjectDraftItemOptions = {
  title: string;
  body?: string;
  fieldValues?: ProjectFieldValue;
};

type ProjectItemOptions = {
  contentNodeId: string;
};

type ProjectCloneOptions = {
  title: string;
  includeDraftIssues?: boolean;
};

type ProjectDetails = {
  closed: boolean;
  closedAt: string;
  createdAt: string;
  number: number;
  public: boolean;
  readme: string;
  shortDescription: string;
  title: string;
  updatedAt: string;
  url: string;
};

export class OrganizationProject {
  private _projects: OrganizationProjects;
  private _operations: IOperationsInstance;

  private _getAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _purpose: AppPurpose;

  private _id: string;

  constructor(
    organizationProjects: OrganizationProjects,
    operations: IOperationsInstance,
    getAuthorizationHeader: PurposefulGetAuthorizationHeader,
    getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader,
    projectId: string
  ) {
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._getSpecificAuthorizationHeader = getSpecificAuthorizationHeader;
    this._projects = organizationProjects;
    this._operations = operations;
    this._purpose = AppPurpose.Operations;
    this._id = projectId;
  }

  overrideDefaultAppPurpose(purpose: AppPurpose) {
    this._purpose = purpose;
  }

  get organization(): Organization {
    return this._projects.organization;
  }

  get projects(): OrganizationProjects {
    return this._projects;
  }

  async getDetails(): Promise<ProjectDetails> {
    const operations = throwIfNotGitHubCapable(this._operations);
    try {
      const result = await operations.github.graphql(this.authorize(), query.getProject, {
        id: this._id,
      });
      return result?.node as ProjectDetails;
    } catch (error) {
      throw error;
    }
  }

  async getFields(
    options: PaginationPageSizeOptions = { pageSize: DefaultGraphqlPageSize }
  ): Promise<ProjectFieldEssentials[]> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const pageSize = options?.pageSize || DefaultGraphqlPageSize;
    try {
      const result = await operations.github.graphql(
        this.authorize(),
        query.getFields(pageSize),
        {
          id: this._id,
        },
        {
          paginate: true,
        }
      );
      return result?.node?.fields?.nodes as ProjectFieldEssentials[];
    } catch (error) {
      throw error;
    }
  }

  async getFieldsIterator(
    options: PaginationPageSizeOptions = { pageSize: DefaultGraphqlPageSize }
  ): Promise<AsyncIterable<ProjectFieldsIteratorResponse> & IteratorPickerResponse<ProjectFieldEssentials>> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const pageSize = options?.pageSize || DefaultGraphqlPageSize;
    try {
      const result = (await operations.github.graphqlIteration(
        this.authorize(this._purpose),
        query.getFields(pageSize),
        {
          id: this._id,
        }
      )) as AsyncIterable<ProjectFieldsIteratorResponse>;
      return decorateIterable<ProjectFieldEssentials, ProjectFieldsIteratorResponse>(result, 'node.fields');
    } catch (error) {
      throw error;
    }
  }

  async getViews(): Promise<ProjectViewEssentials[]> {
    const operations = throwIfNotGitHubCapable(this._operations);
    try {
      const response = await operations.github.graphql(
        this.authorize(),
        query.getViews,
        {
          id: this._id,
        },
        {
          paginate: true,
        }
      );
      return response?.node?.views?.nodes as ProjectViewEssentials[];
    } catch (error) {
      throw error;
    }
  }

  async getViewsIterator(): Promise<
    AsyncIterable<ProjectViewsIteratorResponse> & IteratorPickerResponse<ProjectViewEssentials>
  > {
    const operations = throwIfNotGitHubCapable(this._operations);
    try {
      const result = (await operations.github.graphqlIteration(
        this.authorize(this._purpose),
        query.getViews,
        {
          id: this._id,
        }
      )) as AsyncIterable<ProjectFieldsIteratorResponse>;
      return decorateIterable<ProjectViewEssentials, ProjectViewsIteratorResponse>(result, 'node.views');
    } catch (error) {
      throw error;
    }
  }

  async clone(
    destinationOrganization: Organization,
    options: ProjectCloneOptions
  ): Promise<OrganizationProject> {
    if (!options?.title) {
      throw CreateError.InvalidParameters('options.title is required when cloning a project');
    }
    const destinationOrganizationId = await destinationOrganization.getGraphQlNodeId();
    const operations = throwIfNotGitHubCapable(this._operations);
    const projectId = this._id;
    const mutation = query.cloneProject;
    try {
      const result = await operations.github.graphql(this.authorize(), mutation, {
        projectId,
        ownerId: destinationOrganizationId,
        title: options.title,
        includeDraftIssues: options.includeDraftIssues || false,
        headers: {
          'GraphQL-Features': enableCloneProjectApi,
        },
      });
      const root = result?.copyProjectV2;
      const newProject = root?.projectV2;
      if (newProject?.id) {
        return destinationOrganization.projects.get(newProject.id);
      }
    } catch (error) {
      throw error;
    }
  }

  async getItems(options?: ProjectGetItemsOptions): Promise<ProjectItemEssentials[]> {
    options = options || {};
    const fixedFirstFieldsCount = 8;
    const operations = throwIfNotGitHubCapable(this._operations);
    try {
      const response = await operations.github.graphql(
        this.authorize(),
        options?.includeFields ? query.getItemsWithFields(fixedFirstFieldsCount) : query.getItems,
        {
          id: this._id,
        },
        {
          paginate: true,
        }
      );
      return response?.node?.items?.nodes as ProjectItemEssentials[];
    } catch (error) {
      throw error;
    }
  }

  async getItemsIterator(): Promise<
    AsyncIterable<ProjectItemsIteratorResponse> & IteratorPickerResponse<ProjectItemEssentials>
  > {
    const operations = throwIfNotGitHubCapable(this._operations);
    try {
      const result = (await operations.github.graphqlIteration(
        this.authorize(this._purpose),
        query.getItems,
        {
          id: this._id,
        }
      )) as AsyncIterable<ProjectItemsIteratorResponse>;
      return decorateIterable<ProjectItemEssentials, ProjectItemsIteratorResponse>(result, 'node.items');
    } catch (error) {
      throw error;
    }
  }

  view(viewNodeId: string, essentials?: ProjectViewEssentials) {
    const view = new OrganizationProjectView(
      this,
      this._operations,
      this._getAuthorizationHeader,
      this._getSpecificAuthorizationHeader,
      viewNodeId,
      essentials
    );
    return view;
  }

  async addItem(options: ProjectItemOptions): Promise<ProjectItemEssentials> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const projectId = this._id;
    const mutation = query.addItem;
    try {
      const response = await operations.github.graphql(this.authorize(), mutation, {
        projectId,
        contentId: options.contentNodeId,
      });
      return {
        id: response.addProjectV2ItemById.item.id,
        fieldValues: null,
      };
    } catch (error) {
      throw error;
    }
  }

  async addDraftItem(options: ProjectDraftItemOptions): Promise<ProjectItemEssentials> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const projectId = this._id;
    const mutation = query.addDraftItem;
    try {
      const response = await operations.github.graphql(this.authorize(), mutation, {
        projectId,
        title: options.title,
        body: options.body,
      });
      return {
        id: response.addProjectV2DraftIssue.projectItem.id,
        content: {
          title: options.title,
          body: options.body,
        },
        fieldValues: null,
      };
    } catch (error) {
      throw error;
    }
  }

  async attachToRepository(repository: Repository): Promise<void> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const repositoryNodeId = await repository.getGraphQlNodeId();
    const projectId = this._id;
    const mutation = query.attachToRepository;
    try {
      await operations.github.graphql(this.authorize(), mutation, {
        projectId,
        repositoryId: repositoryNodeId,
      });
    } catch (error) {
      throw error;
    }
  }

  async removeItem(itemNodeId: string): Promise<void> {
    // deleteProjectV2Item
    const operations = throwIfNotGitHubCapable(this._operations);
    const projectId = this._id;
    const mutation = query.removeItem;
    try {
      await operations.github.graphql(this.authorize(), mutation, {
        projectId,
        itemId: itemNodeId,
      });
    } catch (error) {
      throw error;
    }
  }

  async updateItemFieldOption(itemId: string, fieldId: string, singleSelectOptionId: string): Promise<void> {
    const operations = throwIfNotGitHubCapable(this._operations);
    const projectId = this._id;
    const value = {
      singleSelectOptionId,
    };
    const mutation = query.updateItemFieldOption;
    try {
      const result = await operations.github.graphql(this.authorize(), mutation, {
        projectId,
        itemId,
        fieldId,
        value,
      });
      return result;
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

const query = {
  removeItem: `
    mutation removeItem($projectId:ID!, $itemId:ID!) {
      deleteProjectV2Item(input:{
        projectId:$projectId,
        itemId:$itemId,
      }) {
        deletedItemId
      }
    }
  `,
  updateItemFieldOption: `
    mutation updateField($projectId:ID!, $itemId:ID!, $fieldId:ID!, $value:ProjectV2FieldValue!) {
      updateProjectV2ItemFieldValue(input:{
        projectId:$projectId,
        itemId:$itemId,
        fieldId:$fieldId,
        value: $value,
      }) {
        projectV2Item {
          id
        }
      }
    }
  `,
  attachToRepository: `
    mutation attachToRepository($projectId:ID!, $repositoryId:ID!) {
      linkProjectV2ToRepository(input:{
        projectId:$projectId,
        repositoryId:$repositoryId,
      }) {
        repository {
          id
        }
      }
    }
  `,
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
  cloneProject: `
    mutation cloneProject($projectId:ID!, $ownerId:ID!, $title:String!, $includeDraftIssues:Boolean!) {
      copyProjectV2(input:{
        projectId:$projectId,
        ownerId:$ownerId,
        title:$title,
        includeDraftIssues:$includeDraftIssues
      }) {
        projectV2 {
          id
        }
      }
    }
  `,
  addItem: `
    mutation addProjectV2Item($projectId:ID!, $contentId:ID!) {
      addProjectV2ItemById(input:{
        projectId:$projectId,
        contentId:$contentId,
      }) {
        item {
          id
        }
      }
    }
  `,
  getProject: `
    query projectInformation($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          closed
          closedAt
          createdAt
          number
          public
          readme
          shortDescription
          title
          updatedAt
          url
        }
      }
    }
  `,
  addDraftItem: `
    mutation addProjectV2DraftIssue($projectId:ID!, $title:String!, $body:String) {
      addProjectV2DraftIssue(input:{
        projectId:$projectId,
        title:$title,
        body:$body,
      }) {
        projectItem {
          id
        }
      }
    }
  `,
  getItemsWithFields: (firstFieldsNumber: number) => /* to prevent injection risk, only system input */ `
    query paginate($cursor: String, $id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          items(first: 10, after: $cursor) {
            nodes {
              id
              fieldValues(first: ${firstFieldsNumber}) {
                nodes{                
                  ... on ProjectV2ItemFieldTextValue {
                    text
                    field {
                      ... on ProjectV2FieldCommon {
                        name
                        id
                      }
                    }
                  }
                  ... on ProjectV2ItemFieldDateValue {
                    date
                    field {
                      ... on ProjectV2FieldCommon {
                        name
                        id
                      }
                    }
                  }
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    optionId
                    field {
                      ... on ProjectV2FieldCommon {
                        name
                        id
                      }
                    }
                  }
                }              
              }
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
  getFields: (pageSize: number) => /* to prevent injection risk, only system input */ `
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
