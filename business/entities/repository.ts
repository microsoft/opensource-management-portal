//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { GitHubRepositoryVisibility } from '../../interfaces';
import {
  EntityMetadataBase,
  EntityMetadataMappings,
  EntityMetadataType,
  IEntityMetadata,
  IEntityMetadataBaseOptions,
  IEntityMetadataFixedQuery,
  keyValueMetadataField,
  MetadataMappingDefinition,
  QueryBase,
} from '../../lib/entityMetadataProvider';
import { PostgresConfiguration, PostgresSettings } from '../../lib/entityMetadataProvider/postgres';
import { ErrorHelper } from '../../lib/transitional';

const type = new EntityMetadataType('RepositoryDetails');
const typeColumnValue = 'repositorydetails';
const defaultTableName = 'repositories';
const thisProviderType = type;
type InterfaceProviderType = IRepositoryProvider;
type ClassType = RepositoryEntity;
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => {
  return new RepositoryEntity();
});

class ThisQueryBase extends QueryBase<ClassType> {
  constructor(public query: Query) {
    super();
  }
}

class ThisQuery<T> extends ThisQueryBase {
  constructor(
    query: Query,
    public parameters: T
  ) {
    super(query);
    if (!this.parameters) {
      this.parameters = {} as T;
    }
  }
}

const repositoryId = 'repositoryId';
const primaryFieldId = repositoryId;

interface IProperties {
  repositoryId: any;
  organizationId: any;
  cached: any;
  name: any;
  organizationLogin: any;
  fullName: any;
  private: any;
  visibility: any;
  fork: any;
  archived: any;
  disabled: any;
  pushedAt: any;
  createdAt: any;
  updatedAt: any;
  description: any;
  homepage: any;
  language: any;
  forksCount: any;
  stargazersCount: any;
  watchersCount: any;
  size: any;
  defaultBranch: any;
  openIssuesCount: any;
  topics: any; // array of strings
  hasIssues: any;
  hasProjects: any;
  hasWiki: any;
  hasPages: any;
  hasDownloads: any;
  subscribersCount: any;
  networkCount: any;
  license: any; // ?
  parentId: any;
  parentName: any;
  parentOrganizationName: any;
  parentOrganizationId: any;
  additionalData: any;
}

const Field: IProperties = {
  [keyValueMetadataField]: keyValueMetadataField,
  repositoryId: 'repositoryId',
  organizationId: 'organizationId',
  cached: 'cached',
  name: 'name',
  organizationLogin: 'organizationLogin',
  fullName: 'fullName',
  private: 'private',
  visibility: 'visibility',
  fork: 'fork',
  archived: 'archived',
  disabled: 'disabled',
  pushedAt: 'pushedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  description: 'description',
  homepage: 'homepage',
  language: 'language',
  forksCount: 'forksCount',
  stargazersCount: 'stargazersCount',
  watchersCount: 'watchersCount',
  size: 'size',
  defaultBranch: 'defaultBranch',
  openIssuesCount: 'openIssuesCount',
  topics: 'topics',
  hasIssues: 'hasIssues',
  hasProjects: 'hasProjects',
  hasWiki: 'hasWiki',
  hasPages: 'hasPages',
  hasDownloads: 'hasDownloads',
  subscribersCount: 'subscribersCount',
  networkCount: 'networkCount',
  license: 'license',
  parentId: 'parentId',
  parentName: 'parentName',
  parentOrganizationName: 'parentOrganizationName',
  parentOrganizationId: 'parentOrganizationId',
};

const dateColumns = [Field.cached, Field.pushedAt, Field.createdAt, Field.updatedAt];

enum Query {}

export class RepositoryEntity implements IProperties {
  repositoryId: number;
  organizationId: number;
  [keyValueMetadataField]: Record<string, any>;

  name: string;
  organizationLogin: string;
  fullName: string;

  cached: Date;
  private: boolean;
  visibility: GitHubRepositoryVisibility;
  fork: boolean;
  archived: boolean;
  disabled: boolean; // ?
  pushedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  description: string;
  homepage: string;
  language: string; // ?
  forksCount: number;
  stargazersCount: number;
  watchersCount: number;
  size: number;
  defaultBranch: string;
  openIssuesCount: number;
  topics: string[]; // ?
  hasIssues: boolean;
  hasProjects: boolean;
  hasWiki: boolean;
  hasPages: boolean;
  hasDownloads: boolean;
  subscribersCount: number;
  networkCount: number;
  license: string; // ??
  parentId: number;
  parentName: string;
  parentOrganizationName: string;
  parentOrganizationId: number;

  asJson() {
    // Based on the hard-coded names, nothing intelligent.
    return {
      id: this.repositoryId,
      name: this.name,
      organization:
        this.organizationLogin && this.organizationId
          ? {
              id: this.organizationId,
              login: this.organizationLogin,
            }
          : null,
      full_name: this.fullName || `${this.organizationLogin}/${this.name}`,
      private: this.private,
      visibility: this.visibility,
      fork: this.fork,
      archived: this.archived,
      disabled: this.disabled,
      pushed_at: this.pushedAt ? new Date(this.pushedAt).toISOString() : undefined,
      created_at: this.createdAt ? new Date(this.createdAt).toISOString() : undefined,
      updated_at: this.updatedAt ? new Date(this.updatedAt).toISOString() : undefined,
      description: this.description,
      homepage: this.homepage,
      language: this.language,
      forks_count: this.forksCount,
      stargazers_count: this.stargazersCount,
      watchers_count: this.watchersCount,
      size: this.size,
      default_branch: this.defaultBranch,
      open_issues_count: this.openIssuesCount,
      topics: this.topics,
      has_issues: this.hasIssues,
      has_projects: this.hasProjects,
      has_wiki: this.hasWiki,
      has_downloads: this.hasDownloads,
      subscribers_count: this.subscribersCount,
      network_count: this.networkCount,
      license: this.license ? { spdx_id: this.license } : null,
      parent:
        this.parentId && this.parentName && this.parentOrganizationId && this.parentOrganizationName
          ? {
              id: this.parentId,
              name: this.parentName,
              organization: {
                id: this.parentOrganizationId,
                login: this.parentOrganizationName,
              },
            }
          : null,
    };
  }
}

EntityMetadataMappings.Register(
  type,
  PostgresSettings.PostgresQueries,
  (
    query: IEntityMetadataFixedQuery,
    mapMetadataPropertiesToFields: string[],
    metadataColumnName: string,
    tableName: string,
    getEntityTypeColumnValue
  ) => {
    const base = query as ThisQueryBase;
    switch (base.query) {
      default:
        throw new Error(`The query ${base.query} is not implemented by this provider for the type ${type}`);
    }
  }
);

export interface IRepositoryProvider {
  initialize(): Promise<void>;
  get(repositoryId: number): Promise<ClassType>;
  insert(entity: ClassType): Promise<string>;
  replace(entity: ClassType): Promise<void>;
  delete(entity: ClassType): Promise<void>;
}

export class RepositoryProvider extends EntityMetadataBase implements IRepositoryProvider {
  constructor(options: IEntityMetadataBaseOptions) {
    super(thisProviderType, options);
    EntityImplementation.EnsureDefinitions();
  }

  async replace(metadata: ClassType): Promise<void> {
    const entity = this.serialize(thisProviderType, metadata);
    await this._entities.updateMetadata(entity);
  }

  async delete(metadata: ClassType): Promise<void> {
    const entity = this.serialize(thisProviderType, metadata);
    await this._entities.deleteMetadata(entity);
  }

  async get(repositoryId: number): Promise<ClassType> {
    this.ensureHelpers(thisProviderType);
    let metadata: IEntityMetadata = null;
    metadata = await this._entities.getMetadata(thisProviderType, String(repositoryId));
    return this.deserialize<ClassType>(thisProviderType, metadata);
  }

  async insert(metadata: ClassType): Promise<string> {
    const entity = this.serialize(thisProviderType, metadata);
    await this._entities.setMetadata(entity);
    return entity.entityId;
  }

  rowToEntity(row: unknown) {
    const metadata = PostgresConfiguration.RowToMetadataObject(type, row);
    return this.deserialize<RepositoryEntity>(thisProviderType, metadata);
  }
}

export default async function initializeRepositoryProvider(
  options?: IEntityMetadataBaseOptions
): Promise<InterfaceProviderType> {
  const provider = new RepositoryProvider(options);
  await provider.initialize();
  return provider;
}

const fieldNames = Object.getOwnPropertyNames(Field);
const nativeFieldNames = fieldNames.filter((x) => x !== Field[keyValueMetadataField]);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, primaryFieldId);
EntityMetadataMappings.Register(type, PostgresSettings.PostgresDefaultTypeColumnName, typeColumnValue);
EntityMetadataMappings.Register(type, PostgresSettings.PostgresDateColumns, dateColumns);

PostgresConfiguration.SetDefaultTableName(type, defaultTableName);
PostgresConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
PostgresConfiguration.IdentifyNativeFields(type, nativeFieldNames);
PostgresConfiguration.ValidateMappings(type, fieldNames, [primaryFieldId]);

// Runtime validation of FieldNames
for (let i = 0; i < fieldNames.length; i++) {
  const fn = fieldNames[i];
  if (Field[fn] !== fn) {
    throw new Error(`Field name ${fn} and value do not match in ${__filename}`);
  }
}

export async function tryGetRepositoryEntity(
  repositoryProvider: IRepositoryProvider,
  repositoryId: number
): Promise<RepositoryEntity> {
  try {
    const repositoryEntity = await repositoryProvider.get(repositoryId);
    return repositoryEntity;
  } catch (error) {
    if (ErrorHelper.IsNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export const EntityImplementation = {
  Type: type,
  EnsureDefinitions: () => {},
};
