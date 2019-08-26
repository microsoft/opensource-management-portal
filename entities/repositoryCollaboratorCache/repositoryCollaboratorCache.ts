//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { EntityField } from '../../lib/entityMetadataProvider/entityMetadataProvider';
import { EntityMetadataType, IEntityMetadata } from '../../lib/entityMetadataProvider/entityMetadata';
import { IEntityMetadataFixedQuery, FixedQueryType } from '../../lib/entityMetadataProvider/query';
import { EntityMetadataMappings, MetadataMappingDefinition } from '../../lib/entityMetadataProvider/declarations';
import { GitHubRepositoryPermission } from '../repositoryMetadata/repositoryMetadata';
import { GitHubCollaboratorType } from '../../business/repository';

const type = EntityMetadataType.RepositoryCollaboratorCache;

interface IRepositoryCollaboratorCacheProperties {
  // entity ID: orgid:repoid:userid
  uniqueId: any;

  cacheUpdated: any;
  organizationId: any;
  repositoryId: any;
  userId: any;
  permission: any;

  login: any;
  avatar: any;
  collaboratorType: any;
}

const Field: IRepositoryCollaboratorCacheProperties = {
  uniqueId: 'uniqueId',
  cacheUpdated: 'cacheUpdated',

  organizationId: 'organizationId',
  repositoryId: 'repositoryId',
  userId: 'userId',
  permission: 'permission',
  login: 'login',
  avatar: 'avatar',
  collaboratorType: 'collaboratorType',
}

const fieldNames = Object.getOwnPropertyNames(Field);

export class RepositoryCollaboratorCacheEntity implements IRepositoryCollaboratorCacheProperties {
  uniqueId: string;
  cacheUpdated: Date;

  organizationId: string;
  repositoryId: string;
  userId: string;

  permission: GitHubRepositoryPermission;
  login: string;
  avatar: string;
  collaboratorType: GitHubCollaboratorType;

  public static GenerateIdentifier(organizationId: string, repositoryId: string, userId: string) {
    if (!organizationId) {
      throw new Error('organizationId required');
    }
    if (!repositoryId) {
      throw new Error('repositoryId required');
    }
    if (!userId) {
      throw new Error('userId required');
    }
    return `${organizationId}:${repositoryId}:${userId}`;
  }

  constructor() {
    this.cacheUpdated = new Date();
  }
}

export class RepositoryCollaboratorCacheFixedQueryAll implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.RepositoryCollaboratorCacheGetAll;
}

export class RepositoryCollaboratorCacheFixedQueryByOrganizationId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.RepositoryCollaboratorCacheByOrganizationId;
  constructor(public organizationId: string) {
    if (typeof(this.organizationId) !== 'string') {
      throw new Error(`${organizationId} must be a string`);
    }
  }
}

export class RepositoryCollaboratorCacheFixedQueryByUserId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.RepositoryCollaboratorCacheByUserId;
  constructor(public userId: string) {
    if (typeof(this.userId) !== 'string') {
      throw new Error(`${userId} must be a string`);
    }
  }
}

export class RepositoryCollaboratorCacheFixedQueryByRepositoryId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.RepositoryCollaboratorCacheByRepositoryId;
  constructor(public repositoryId: string) {
    if (typeof(this.repositoryId) !== 'string') {
      throw new Error(`${repositoryId} must be a string`);
    }
  }
}

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => { return new RepositoryCollaboratorCacheEntity(); });
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, Field.uniqueId);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.MemoryMapping, new Map<string, string>([
  [Field.avatar, 'avatar'],
  [Field.cacheUpdated, 'cached'],
  [Field.login, 'login'],
  [Field.organizationId, 'orgid'],
  [Field.permission, 'permission'],
  [Field.repositoryId, 'repoid'],
  [Field.uniqueId, 'unique'],
  [Field.userId, 'userid'],
  [Field.collaboratorType, 'collaboratorType'],
]));
EntityMetadataMappings.RuntimeValidateMappings(type, MetadataMappingDefinition.MemoryMapping, fieldNames, []);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresDefaultTableName, 'repositorycollaboratorcache');
EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresDefaultTypeColumnName, 'repositorycollaboratorcache');
EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresMapping, new Map<string, string>([
  [Field.avatar, (Field.avatar as string).toLowerCase()],
  [Field.cacheUpdated, (Field.cacheUpdated as string).toLowerCase()],
  [Field.login, (Field.login as string).toLowerCase()],
  [Field.organizationId, (Field.organizationId as string).toLowerCase()], // net new
  [Field.permission, (Field.permission as string).toLowerCase()],
  [Field.repositoryId, (Field.repositoryId as string).toLowerCase()],
  [Field.uniqueId, (Field.uniqueId as string).toLowerCase()],
  [Field.userId, (Field.userId as string).toLowerCase()],
  [Field.collaboratorType, (Field.collaboratorType as string).toLowerCase()],
]));
EntityMetadataMappings.RuntimeValidateMappings(type, MetadataMappingDefinition.PostgresMapping, fieldNames, []);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresQueries, (query: IEntityMetadataFixedQuery, mapMetadataPropertiesToFields: string[], metadataColumnName: string, tableName: string, getEntityTypeColumnValue) => {
  const entityTypeColumn = mapMetadataPropertiesToFields[EntityField.Type];
  // const entityIdColumn = mapMetadataPropertiesToFields[EntityField.ID];
  const orgIdColumn = mapMetadataPropertiesToFields[Field.organizationId];
  const entityTypeValue = getEntityTypeColumnValue(type);
  let sql = '', values = [];
  switch (query.fixedQueryType) {
    case FixedQueryType.RepositoryCollaboratorCacheGetAll:
      sql = `
        SELECT *
        FROM ${tableName}
        WHERE
          ${entityTypeColumn} = $1
      `;
      values = [
        entityTypeValue,
      ];
      return { sql, values };
    case FixedQueryType.RepositoryCollaboratorCacheByOrganizationId:
      const { organizationId } = query as RepositoryCollaboratorCacheFixedQueryByOrganizationId;
      if (!organizationId) {
        throw new Error('organizationId required');
      }
      sql = `
        SELECT *
        FROM ${tableName}
        WHERE
          ${entityTypeColumn} = $1 AND
          ${orgIdColumn} = $2
      `;
      values = [
        entityTypeValue,
        organizationId,
      ];
      return { sql, values };

    default:
      throw new Error(`The fixed query type "${query.fixedQueryType}" is not implemented by this provider for repository for the type ${type}, or is of an unknown type`);
  }
});

EntityMetadataMappings.Register(type, MetadataMappingDefinition.MemoryQueries, (query: IEntityMetadataFixedQuery, allInTypeBin: IEntityMetadata[]) => {
  switch (query.fixedQueryType) {
    case FixedQueryType.RepositoryCollaboratorCacheGetAll:
      return allInTypeBin;

    case FixedQueryType.RepositoryCollaboratorCacheByOrganizationId:
      const { organizationId } = query as RepositoryCollaboratorCacheFixedQueryByOrganizationId;
      if (!organizationId) {
        throw new Error('organizationId required');
      }
      throw new Error('Not implemented yet');
    default:
      throw new Error(`The fixed query type "${query.fixedQueryType}" is not implemented by this provider for repository for the type ${type}, or is of an unknown type`);
  }
});

// Runtime validation of FieldNames
for (let i = 0; i < fieldNames.length; i++) {
  const fn = fieldNames[i];
  if (Field[fn] !== fn) {
    throw new Error(`Field name ${fn} and value do not match in ${__filename}`);
  }
}

export const EntityImplementation = {
  EnsureDefinitions: () => {},
  Type: type,
};
