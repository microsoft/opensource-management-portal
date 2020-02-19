//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { EntityField} from '../../lib/entityMetadataProvider/entityMetadataProvider';
import { EntityMetadataType, IEntityMetadata } from '../../lib/entityMetadataProvider/entityMetadata';
import { IEntityMetadataFixedQuery, FixedQueryType } from '../../lib/entityMetadataProvider/query';
import { EntityMetadataMappings, MetadataMappingDefinition } from '../../lib/entityMetadataProvider/declarations';
import { PostgresGetAllEntities, PostgresJsonEntityQuery } from '../../lib/entityMetadataProvider/postgres';
import { stringOrNumberAsString } from '../../utils';

const type = EntityMetadataType.RepositoryCache;

interface IRepositoryCacheProperties {
  organizationId: any;
  repositoryName: any;
  repositoryDetails: any;
  cacheUpdated: any;
}

const repositoryId = 'repositoryId';

const Field: IRepositoryCacheProperties = {
  organizationId: 'organizationId',
  repositoryName: 'repositoryName',
  repositoryDetails: 'repositoryDetails',
  cacheUpdated: 'cacheUpdated',
}

const fieldNames = Object.getOwnPropertyNames(Field);

export class RepositoryCacheEntity implements IRepositoryCacheProperties {
  repositoryId: string;
  repositoryName: string;
  organizationId: string;
  repositoryDetails: any;
  cacheUpdated: Date;

  constructor() {
    this.cacheUpdated = new Date();
  }
}

export class RepositoryCacheFixedQueryAll implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.RepositoryCacheGetAll;
}

export class RepositoryCacheFixedQueryByOrganizationId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.RepositoryCacheGetByOrganizationId;
  constructor(public organizationId: string) {
    if (typeof(this.organizationId) !== 'string') {
      throw new Error(`${organizationId} must be a string`);
    }
  }
}

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => { return new RepositoryCacheEntity(); });
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, repositoryId);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.MemoryMapping, new Map<string, string>([
  [Field.organizationId, 'orgid'],
  [Field.repositoryName, 'repoName'],
  [Field.repositoryDetails, 'repoDetails'],
  [Field.cacheUpdated, 'cached'],
]));
EntityMetadataMappings.RuntimeValidateMappings(type, MetadataMappingDefinition.MemoryMapping, fieldNames, [repositoryId]);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresDefaultTableName, 'repositorycache');
EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresDefaultTypeColumnName, 'repositorycache');
EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresMapping, new Map<string, string>([
  [Field.organizationId, (Field.organizationId as string).toLowerCase()], // net new
  [Field.repositoryName, (Field.repositoryName as string).toLowerCase()],
  [Field.repositoryDetails, (Field.repositoryDetails as string).toLowerCase()],
  [Field.cacheUpdated, (Field.cacheUpdated as string).toLowerCase()],
]));
EntityMetadataMappings.RuntimeValidateMappings(type, MetadataMappingDefinition.PostgresMapping, fieldNames, [repositoryId]);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresQueries, (query: IEntityMetadataFixedQuery, mapMetadataPropertiesToFields: string[], metadataColumnName: string, tableName: string, getEntityTypeColumnValue) => {
  const entityTypeColumn = mapMetadataPropertiesToFields[EntityField.Type];
  const entityTypeValue = getEntityTypeColumnValue(type);
  switch (query.fixedQueryType) {
    case FixedQueryType.RepositoryCacheGetAll:
      return PostgresGetAllEntities(tableName, entityTypeColumn, entityTypeValue);
    case FixedQueryType.RepositoryCacheGetByOrganizationId: {
      const { organizationId } = query as RepositoryCacheFixedQueryByOrganizationId;
      if (!organizationId) {
        throw new Error('organizationId required');
      }
      return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
        organizationid: stringOrNumberAsString(organizationId),
      });
    }
    default:
      throw new Error(`The fixed query type "${query.fixedQueryType}" is not implemented by this provider for repository for the type ${type}, or is of an unknown type`);
  }
});

EntityMetadataMappings.Register(type, MetadataMappingDefinition.MemoryQueries, (query: IEntityMetadataFixedQuery, allInTypeBin: IEntityMetadata[]) => {
  switch (query.fixedQueryType) {
    case FixedQueryType.RepositoryCacheGetAll:
      return allInTypeBin;
    case FixedQueryType.RepositoryCacheGetByOrganizationId: {
      const { organizationId } = query as RepositoryCacheFixedQueryByOrganizationId;
      if (!organizationId) {
        throw new Error('organizationId required');
      }
      throw new Error('Not implemented yet');
    }
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
