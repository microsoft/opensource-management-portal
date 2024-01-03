//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { EntityField } from '../../../lib/entityMetadataProvider/entityMetadataProvider';
import { EntityMetadataType, IEntityMetadata } from '../../../lib/entityMetadataProvider/entityMetadata';
import { IEntityMetadataFixedQuery, FixedQueryType } from '../../../lib/entityMetadataProvider/query';
import {
  EntityMetadataMappings,
  MetadataMappingDefinition,
} from '../../../lib/entityMetadataProvider/declarations';
import {
  PostgresJsonEntityQuery,
  PostgresGetAllEntities,
  PostgresSettings,
  PostgresConfiguration,
} from '../../../lib/entityMetadataProvider/postgres';
import { TeamCacheFixedQueryByOrganizationId, TeamCacheDeleteByOrganizationId } from '.';
import { stringOrNumberAsString } from '../../../lib/utils';
import { MemoryConfiguration, MemorySettings } from '../../../lib/entityMetadataProvider/memory';
import { TableConfiguration } from '../../../lib/entityMetadataProvider';

const type = new EntityMetadataType('TeamCache');

interface ITeamCacheProperties {
  organizationId: any;
  teamName: any;
  teamSlug: any;
  teamDescription: any;
  teamDetails: any;
  cacheUpdated: any;
}

const teamId = 'teamId';

const Field: ITeamCacheProperties = {
  organizationId: 'organizationId',
  teamName: 'teamName',
  teamSlug: 'teamSlug',
  teamDescription: 'teamDescription',
  teamDetails: 'teamDetails',
  cacheUpdated: 'cacheUpdated',
};

const fieldNames = Object.getOwnPropertyNames(Field);

export class TeamCacheEntity implements ITeamCacheProperties {
  teamId: string;
  teamName: string;
  teamSlug: string;
  teamDescription: string;
  organizationId: string;
  teamDetails: any;
  cacheUpdated: Date;

  constructor() {
    this.cacheUpdated = new Date();
  }
}

const defaultTableName = 'teamcache';

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => {
  return new TeamCacheEntity();
});
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, teamId);

MemoryConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
EntityMetadataMappings.RuntimeValidateMappings(type, MemorySettings.MemoryMapping, fieldNames, [teamId]);

TableConfiguration.SetDefaultTableName(type, defaultTableName);
TableConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
TableConfiguration.SetFixedPartitionKey(type, defaultTableName);

PostgresConfiguration.SetDefaultTableName(type, defaultTableName);
EntityMetadataMappings.Register(type, PostgresSettings.PostgresDefaultTypeColumnName, 'teamcache');
PostgresConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
PostgresConfiguration.ValidateMappings(type, fieldNames, [teamId]);

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
      case FixedQueryType.TeamCacheGetAll: {
        return PostgresGetAllEntities(tableName, entityTypeColumn, entityTypeValue);
      }
      case FixedQueryType.TeamCacheDeleteByOrganizationId: {
        const { organizationId } = query as TeamCacheDeleteByOrganizationId;
        return {
          sql: `DELETE FROM ${tableName} WHERE ${metadataColumnName}->>'organizationid' = $1`,
          values: [organizationId],
          skipEntityMapping: true,
        };
      }
      case FixedQueryType.TeamCacheGetOrganizationIds: {
        return {
          sql: `
          SELECT DISTINCT(${metadataColumnName}->>'organizationid') as organizationid
          FROM ${tableName}`,
          values: [],
          skipEntityMapping: true,
        };
      }
      case FixedQueryType.TeamCacheGetByOrganizationId: {
        const { organizationId } = query as TeamCacheFixedQueryByOrganizationId;
        if (!organizationId) {
          throw new Error('organizationId required');
        }
        return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
          organizationid: stringOrNumberAsString(organizationId),
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
      case FixedQueryType.TeamCacheGetAll:
        return allInTypeBin;
      case FixedQueryType.TeamCacheGetByOrganizationId:
        const { organizationId } = query as TeamCacheFixedQueryByOrganizationId;
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

// Runtime validation of FieldNames
for (let i = 0; i < fieldNames.length; i++) {
  const fn = fieldNames[i];
  if (Field[fn] !== fn) {
    throw new Error(`Field name ${fn} and value do not match in ${__filename}`);
  }
}

export const EntityImplementation = {
  Type: type,
  EnsureDefinitions: () => {},
};
