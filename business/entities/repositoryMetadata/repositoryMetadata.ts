//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { EntityField } from '../../../lib/entityMetadataProvider/entityMetadataProvider';
import type { IEntityMetadata } from '../../../lib/entityMetadataProvider/entityMetadata';
import { type IEntityMetadataFixedQuery, FixedQueryType } from '../../../lib/entityMetadataProvider/query';
import {
  EntityMetadataMappings,
  MetadataMappingDefinition,
} from '../../../lib/entityMetadataProvider/declarations';
import { Type } from './type';
import {
  PostgresGetAllEntities,
  PostgresGetByID,
  PostgresSettings,
  PostgresConfiguration,
} from '../../../lib/entityMetadataProvider/postgres';
import { TableSettings } from '../../../lib/entityMetadataProvider/table';
import { MemoryConfiguration, MemorySettings } from '../../../lib/entityMetadataProvider/memory';
import { odata, TableEntityQueryOptions } from '@azure/data-tables';
import {
  GitHubRepositoryVisibility,
  IInitialTeamPermission,
  RepositoryLockdownState,
} from '../../../interfaces/github/repos';

const type = Type;

interface IRepositoryMetadataProperties {
  createdByThirdPartyId: any;
  createdByThirdPartyUsername: any;

  createdByCorporateDisplayName: any;
  createdByCorporateId: any;
  createdByCorporateUsername: any;

  created: any;

  organizationName: any;
  organizationId: any;

  // THIS IS THE PRIMARY ID: repositoryId: any;
  repositoryName: any;

  initialTeamPermissions: any;
  initialAdministrators: any;
  initialRepositoryDescription: any;
  initialRepositoryVisibility: any;
  initialRepositoryHomepage: any;

  initialLicense: any;
  initialTemplate: any;
  initialGitIgnoreTemplate: any;

  initialCorrelationId: any;

  lockdownState: any;

  transferSource: any;

  projectType: any;
  releaseReviewJustification: any;
  releaseReviewType: any;
  releaseReviewUrl: any;
}

const azureTableRowKey = 'azureTableRowKey';
const azureTableRepositoryIdField = 'repoId';

const repositoryId = 'repositoryId';

const Field: IRepositoryMetadataProperties = {
  // repositoryId: 'repositoryId',
  createdByThirdPartyId: 'createdByThirdPartyId',
  createdByThirdPartyUsername: 'createdByThirdPartyUsername',
  createdByCorporateDisplayName: 'createdByCorporateDisplayName',
  createdByCorporateId: 'createdByCorporateId',
  createdByCorporateUsername: 'createdByCorporateUsername',
  created: 'created',
  organizationName: 'organizationName',
  organizationId: 'organizationId',
  repositoryName: 'repositoryName',
  initialAdministrators: 'initialAdministrators',
  initialTeamPermissions: 'initialTeamPermissions',
  initialRepositoryDescription: 'initialRepositoryDescription',
  initialRepositoryVisibility: 'initialRepositoryVisibility',
  initialLicense: 'initialLicense',
  initialTemplate: 'initialTemplate',
  initialGitIgnoreTemplate: 'initialGitIgnoreTemplate',
  initialCorrelationId: 'initialCorrelationId',
  initialRepositoryHomepage: 'initialRepositoryHomepage',
  projectType: 'projectType',
  releaseReviewJustification: 'releaseReviewJustification',
  releaseReviewType: 'releaseReviewType',
  releaseReviewUrl: 'releaseReviewUrl',
  lockdownState: 'lockdownState',
  transferSource: 'transferSource',
};

const fieldNames = Object.getOwnPropertyNames(Field);

export class RepositoryMetadataEntity implements IRepositoryMetadataProperties {
  repositoryId: string;
  repositoryName: string;
  organizationId: string;
  organizationName: string;

  createdByThirdPartyId: string;
  createdByThirdPartyUsername: string;

  createdByCorporateDisplayName: string;
  createdByCorporateId: string;
  createdByCorporateUsername: string;

  created: Date;

  initialTeamPermissions: IInitialTeamPermission[];
  initialAdministrators: string[];
  initialRepositoryDescription: string;
  initialRepositoryVisibility: GitHubRepositoryVisibility;
  initialLicense: string;
  initialTemplate: string;
  initialGitIgnoreTemplate: string;
  initialCorrelationId: string;
  initialRepositoryHomepage: string;

  projectType: string;
  releaseReviewJustification: string;
  releaseReviewType: string;
  releaseReviewUrl: string;

  lockdownState: RepositoryLockdownState;

  transferSource: string;

  constructor() {
    this.initialTeamPermissions = [];
    this.initialAdministrators = [];
    this.initialRepositoryVisibility = GitHubRepositoryVisibility.Public;
  }
}

export class RepositoryMetadataFixedQueryAll implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.AllRepositoryMetadata;
}

export class RepositoryMetadataFixedQueryByRepositoryId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.RepositoryMetadataByRepositoryId;
  constructor(public repositoryId: string) {}
}

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => {
  return new RepositoryMetadataEntity();
});
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, repositoryId);
EntityMetadataMappings.Register(type, TableSettings.TableNoPointQueries, true);
EntityMetadataMappings.Register(
  type,
  TableSettings.TableNoPointQueryMapping,
  new Map<string, string>([
    [repositoryId, azureTableRepositoryIdField], // in table, RowKey is not the repo ID
    [azureTableRowKey, EntityField.ID], // to still point at the row
  ])
);
EntityMetadataMappings.Register(type, TableSettings.TableDefaultTableName, 'pending');
EntityMetadataMappings.Register(type, TableSettings.TableDefaultFixedPartitionKey, 'pk');
EntityMetadataMappings.Register(type, TableSettings.TableNoPointQueryAlternateIdFieldName, azureTableRowKey);
EntityMetadataMappings.Register(
  type,
  TableSettings.TableSpecializedDeserializationHelper,
  function tableRepoMetadataSpecializedDeserializer(
    entity: IEntityMetadata,
    object: RepositoryMetadataEntity
  ) {
    if (!Array.isArray(object.initialTeamPermissions)) {
      throw new Error('RepositoryMetadataEntity.initialTeamPermissions must be an initialized array');
    }
    if (!Array.isArray(object.initialAdministrators)) {
      throw new Error('RepositoryMetadataEntity.initialAdministrators must be an initialized array');
    }
    if (entity['teamsCount'] && !isNaN(entity['teamsCount'])) {
      const teamsCount = parseInt(entity['teamsCount'], 10);
      for (let i = 0; i < teamsCount; i++) {
        const prefix = `teamid${i}`;
        const teamId = entity[prefix];
        const permission = entity[`${prefix}p`];
        if (teamId && permission) {
          object.initialTeamPermissions.push({ teamId, permission });
        } else {
          throw new Error(
            `Table row for id=${entity.entityId} defined an initial team permissions count of ${teamsCount}, but the permissions defined for index ${i} are invalid`
          );
        }
      }
    }
  }
);

EntityMetadataMappings.Register(
  type,
  TableSettings.TableSpecializedSerializationHelper,
  function tableRepoMetadataSpecializedSerializer(entity: IEntityMetadata, object: RepositoryMetadataEntity) {
    entity['tickettype'] = 'repo';
    entity['teamsCount'] = object.initialTeamPermissions.length.toString();
    for (let i = 0; i < object.initialTeamPermissions.length; i++) {
      const { teamId, permission } = object.initialTeamPermissions[i];
      const prefix = `teamid${i}`;
      entity[prefix] = teamId.toString();
      entity[`${prefix}p`] = permission;
    }
  }
);

EntityMetadataMappings.Register(
  type,
  TableSettings.TableMapping,
  new Map<string, string>([
    [Field.createdByThirdPartyId, 'ghid'],
    [Field.createdByThirdPartyUsername, 'ghu'],

    [Field.createdByCorporateDisplayName, 'name'],
    [Field.createdByCorporateId, 'aadid'],
    [Field.createdByCorporateUsername, 'mail'],

    [Field.created, 'requested'],

    [Field.organizationName, 'org'],
    [Field.organizationId, 'orgid'], // net new

    [Field.repositoryName, 'repoName'],
    // [repositoryId, azureTableRepositoryIdField], // in table, RowKey is not the repo ID

    [Field.initialTeamPermissions, null], // special serializer handles
    [Field.initialAdministrators, 'initialAdministrators'], // this may not work

    [Field.initialRepositoryDescription, 'repoDescription'],
    [Field.initialRepositoryVisibility, 'repoVisibility'],
    [Field.initialRepositoryHomepage, 'repoHomepage'],

    [Field.initialLicense, 'license'],
    [Field.initialTemplate, 'template'],
    [Field.initialGitIgnoreTemplate, 'gitignore_template'],
    [Field.initialCorrelationId, 'correlationId'],

    [Field.projectType, 'projectType'],
    [Field.releaseReviewJustification, 'justification'],
    [Field.releaseReviewType, 'approvalType'],
    [Field.releaseReviewUrl, 'approvalUrl'],
    [Field.lockdownState, Field.lockdownState.toLowerCase()],
    [Field.transferSource, Field.transferSource.toLowerCase()],
  ])
);
EntityMetadataMappings.Register(type, TableSettings.TablePossibleDateColumns, [Field.created]);
EntityMetadataMappings.RuntimeValidateMappings(type, TableSettings.TableMapping, fieldNames, [repositoryId]);

MemoryConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
EntityMetadataMappings.RuntimeValidateMappings(type, MemorySettings.MemoryMapping, fieldNames, [
  repositoryId,
]);

const defaultTableName = 'repositorymetadata';
PostgresConfiguration.SetDefaultTableName(type, defaultTableName);
EntityMetadataMappings.Register(type, PostgresSettings.PostgresDefaultTypeColumnName, 'repository');
PostgresConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
PostgresConfiguration.ValidateMappings(type, fieldNames, [repositoryId]);

EntityMetadataMappings.Register(
  type,
  TableSettings.TableQueries,
  (query: IEntityMetadataFixedQuery, fixedPartitionKey: string) => {
    switch (query.fixedQueryType) {
      case FixedQueryType.AllRepositoryMetadata: {
        return {
          filter: odata`  PartitionKey eq ${fixedPartitionKey} and tickettype eq 'repo'  `,
        } as TableEntityQueryOptions;
      }
      case FixedQueryType.RepositoryMetadataByRepositoryId: {
        const { repositoryId } = query as RepositoryMetadataFixedQueryByRepositoryId;
        if (!repositoryId) {
          throw new Error('repositoryId required');
        }
        return {
          filter:
            odata`  PartitionKey eq ${fixedPartitionKey} and tickettype eq 'repo' and ` +
            azureTableRepositoryIdField +
            odata` eq ${repositoryId} `,
        } as TableEntityQueryOptions;
      }
      default: {
        throw new Error(
          `The fixed query type "${query.fixedQueryType}" is not implemented by this provider for the type ${type}, or is of an unknown type`
        );
      }
    }
  }
);

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
    const entityIDColumn = mapMetadataPropertiesToFields[EntityField.ID];
    const entityTypeValue = getEntityTypeColumnValue(type);
    switch (query.fixedQueryType) {
      case FixedQueryType.AllRepositoryMetadata: {
        return PostgresGetAllEntities(tableName, entityTypeColumn, entityTypeValue);
      }
      case FixedQueryType.RepositoryMetadataByRepositoryId: {
        const { repositoryId } = query as RepositoryMetadataFixedQueryByRepositoryId;
        if (!repositoryId) {
          throw new Error('repositoryId required');
        }
        return PostgresGetByID(tableName, entityTypeColumn, entityTypeValue, entityIDColumn, repositoryId);
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
      case FixedQueryType.AllRepositoryMetadata:
        return allInTypeBin;

      case FixedQueryType.RepositoryMetadataByRepositoryId:
        const { repositoryId } = query as RepositoryMetadataFixedQueryByRepositoryId;
        if (!repositoryId) {
          throw new Error('repositoryId required');
        }
        return allInTypeBin[repositoryId];

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
