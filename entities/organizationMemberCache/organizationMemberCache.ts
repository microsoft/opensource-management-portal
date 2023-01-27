//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { EntityField } from '../../lib/entityMetadataProvider/entityMetadataProvider';
import { EntityMetadataType, IEntityMetadata } from '../../lib/entityMetadataProvider/entityMetadata';
import { IEntityMetadataFixedQuery, FixedQueryType } from '../../lib/entityMetadataProvider/query';
import {
  EntityMetadataMappings,
  MetadataMappingDefinition,
} from '../../lib/entityMetadataProvider/declarations';
import { OrganizationMembershipRole } from '../../interfaces';
import { stringOrNumberAsString } from '../../utils';
import {
  PostgresJsonEntityQuery,
  PostgresGetAllEntities,
  PostgresSettings,
  PostgresConfiguration,
} from '../../lib/entityMetadataProvider/postgres';
import { MemoryConfiguration, MemorySettings } from '../../lib/entityMetadataProvider/memory';
import { TableConfiguration, TableSettings } from '../../lib/entityMetadataProvider';
import { odata, TableEntityQueryOptions } from '@azure/data-tables';
import { CreateError } from '../../transitional';

const type = new EntityMetadataType('OrganizationMemberCache');

interface IOrganizationMemberCacheProperties {
  // entity ID: orgid:userid
  uniqueId: any;
  cacheUpdated: any;
  organizationId: any;
  userId: any;
  role: any;
}

const Field: IOrganizationMemberCacheProperties = {
  uniqueId: 'uniqueId',
  cacheUpdated: 'cacheUpdated',
  organizationId: 'organizationId',
  userId: 'userId',
  role: 'role',
};

const fieldNames = Object.getOwnPropertyNames(Field);

const defaultTableName = 'organizationmembercache';

export class OrganizationMemberCacheEntity implements IOrganizationMemberCacheProperties {
  uniqueId: string;
  cacheUpdated: Date;
  organizationId: string;
  userId: string;
  role: OrganizationMembershipRole;

  public static GenerateIdentifier(organizationId: string, userId: string) {
    if (!organizationId) {
      throw new Error('organizationId required');
    }
    if (!userId) {
      throw new Error('userId required');
    }
    return `${organizationId}:${userId}`;
  }

  constructor() {
    this.cacheUpdated = new Date();
  }
}

export class OrganizationBasicsFixedQuery implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.OrganizationCacheGetAllBasics;
}

export class OrganizationMemberCacheDeleteByOrganizationId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType =
    FixedQueryType.OrganizationMemberCacheDeleteByOrganizationId;
  constructor(public organizationId: string) {
    if (typeof this.organizationId !== 'string') {
      throw new Error(`${organizationId} must be a string`);
    }
  }
}

export class OrganizationOwnersQuery implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.OrganizationOwnersCacheByOrganizationId;
  constructor(public organizationId: string) {
    if (typeof this.organizationId !== 'string') {
      throw new Error(`${organizationId} must be a string`);
    }
  }
}

export class OrganizationMemberCacheFixedQueryAll implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.OrganizationMemberCacheGetAll;
}

export class OrganizationMemberCacheFixedQueryByOrganizationId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.OrganizationMemberCacheByOrganizationId;
  constructor(public organizationId: string) {
    if (typeof this.organizationId !== 'string') {
      throw new Error(`${organizationId} must be a string`);
    }
  }
}

export class OrganizationMemberCacheFixedQueryByUserId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.OrganizationMemberCacheByUserId;
  constructor(public userId: string) {
    if (typeof this.userId !== 'string') {
      throw new Error(`${userId} must be a string`);
    }
  }
}

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => {
  return new OrganizationMemberCacheEntity();
});
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, Field.uniqueId);

MemoryConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
EntityMetadataMappings.RuntimeValidateMappings(type, MemorySettings.MemoryMapping, fieldNames, []);

TableConfiguration.SetDefaultTableName(type, defaultTableName);
TableConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
TableConfiguration.SetFixedPartitionKey(type, defaultTableName);

PostgresConfiguration.SetDefaultTableName(type, defaultTableName);
EntityMetadataMappings.Register(
  type,
  PostgresSettings.PostgresDefaultTypeColumnName,
  'organizationmembercache'
);
PostgresConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
PostgresConfiguration.ValidateMappings(type, fieldNames, []);

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
    const entityTypeColumn = mapMetadataPropertiesToFields[EntityField.Type];
    const entityTypeValue = getEntityTypeColumnValue(type);
    switch (query.fixedQueryType) {
      case FixedQueryType.OrganizationMemberCacheGetAll:
        return PostgresGetAllEntities(tableName, entityTypeColumn, entityTypeValue);
      case FixedQueryType.OrganizationMemberCacheDeleteByOrganizationId: {
        const { organizationId } = query as OrganizationMemberCacheDeleteByOrganizationId;
        return {
          sql: `DELETE FROM ${tableName} WHERE ${metadataColumnName}->>'organizationid' = $1`,
          values: [organizationId],
          skipEntityMapping: true,
        };
      }
      case FixedQueryType.OrganizationCacheGetAllBasics: {
        return {
          sql: `
          SELECT DISTINCT(${metadataColumnName}->>'organizationid') as organizationid
          FROM ${tableName}`,
          values: [],
          skipEntityMapping: true,
        };
      }
      case FixedQueryType.OrganizationOwnersCacheByOrganizationId: {
        const { organizationId } = query as OrganizationMemberCacheFixedQueryByOrganizationId;
        if (!organizationId) {
          throw new Error('organizationId required');
        }
        return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
          role: 'admin',
          organizationid: stringOrNumberAsString(organizationId),
        });
      }
      case FixedQueryType.OrganizationMemberCacheByOrganizationId: {
        const { organizationId } = query as OrganizationMemberCacheFixedQueryByOrganizationId;
        if (!organizationId) {
          throw new Error('organizationId required');
        }
        return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
          organizationid: stringOrNumberAsString(organizationId),
        });
      }
      case FixedQueryType.OrganizationMemberCacheByUserId: {
        const { userId } = query as OrganizationMemberCacheFixedQueryByUserId;
        if (!userId) {
          throw new Error('userId required');
        }
        return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
          userid: stringOrNumberAsString(userId),
        });
      }
      default:
        throw new Error(
          `The fixed query type "${query.fixedQueryType}" is not implemented by this provider for the type ${type}, or is of an unknown type`
        );
    }
  }
);

EntityMetadataMappings.Register(
  type,
  MemorySettings.MemoryQueries,
  (query: IEntityMetadataFixedQuery, allInTypeBin: IEntityMetadata[]) => {
    switch (query.fixedQueryType) {
      case FixedQueryType.OrganizationMemberCacheGetAll:
        return allInTypeBin;

      case FixedQueryType.OrganizationMemberCacheByOrganizationId:
        const { organizationId } = query as OrganizationMemberCacheFixedQueryByOrganizationId;
        if (!organizationId) {
          throw new Error('organizationId required');
        }
        throw new Error('Not implemented yet');
      default:
        throw new Error(
          `The fixed query type "${query.fixedQueryType}" is not implemented by this provider for the type ${type}, or is of an unknown type`
        );
    }
  }
);

EntityMetadataMappings.Register(
  type,
  TableSettings.TableQueries,
  (query: IEntityMetadataFixedQuery, fixedPartitionKey: string) => {
    switch (query.fixedQueryType) {
      case FixedQueryType.OrganizationMemberCacheGetAll: {
        return {
          filter: odata`PartitionKey eq ${fixedPartitionKey}`,
        } as TableEntityQueryOptions;
      }
      case FixedQueryType.OrganizationMemberCacheDeleteByOrganizationId: {
        const { organizationId } = query as OrganizationMemberCacheDeleteByOrganizationId;
        throw CreateError.ServerError('Not implemented yet. Requires delete query hack or refactor.');
      }
      case FixedQueryType.OrganizationCacheGetAllBasics: {
        throw CreateError.ServerError('Not implemented.');
      }
      case FixedQueryType.OrganizationOwnersCacheByOrganizationId: {
        const { organizationId } = query as OrganizationMemberCacheFixedQueryByOrganizationId;
        if (!organizationId) {
          throw new Error('organizationId required');
        }
        return {
          filter: odata`PartitionKey eq ${fixedPartitionKey} and role eq 'admin' and organizationid eq ${organizationId}`,
        } as TableEntityQueryOptions;
      }
      case FixedQueryType.OrganizationMemberCacheByOrganizationId: {
        const { organizationId } = query as OrganizationMemberCacheFixedQueryByOrganizationId;
        if (!organizationId) {
          throw new Error('organizationId required');
        }
        return {
          filter: odata`PartitionKey eq ${fixedPartitionKey} and organizationid eq ${organizationId}`,
        } as TableEntityQueryOptions;
      }
      case FixedQueryType.OrganizationMemberCacheByUserId: {
        const { userId } = query as OrganizationMemberCacheFixedQueryByUserId;
        if (!userId) {
          throw new Error('userId required');
        }
        return {
          filter: odata`PartitionKey eq ${fixedPartitionKey} and userid eq ${userId}`,
        } as TableEntityQueryOptions;
      }
      default:
        throw new Error(
          `The fixed query type "${query.fixedQueryType}" is not implemented by this provider for the type ${type}, or is of an unknown type`
        );
    }
  }
);

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
