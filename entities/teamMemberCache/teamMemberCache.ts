//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { EntityField} from '../../lib/entityMetadataProvider/entityMetadataProvider';
import { EntityMetadataType, IEntityMetadata } from '../../lib/entityMetadataProvider/entityMetadata';
import { IEntityMetadataFixedQuery, FixedQueryType } from '../../lib/entityMetadataProvider/query';
import { EntityMetadataMappings, MetadataMappingDefinition } from '../../lib/entityMetadataProvider/declarations';
import { TeamMemberCacheFixedQueryByOrganizationId } from '.';
import { GitHubTeamRole } from '../../business/team';

const type = EntityMetadataType.TeamMemberCache;

interface ITeamMemberCacheProperties {
  uniqueId: any; // orgid:teamid:userid
  cacheUpdated: any;
  organizationId: any;
  teamId: any;
  userId: any;
  teamRole: any;
  login: any;
  avatar: any;
}

const teamId = 'teamId';

const Field: ITeamMemberCacheProperties = {
  uniqueId: 'uniqueId',
  cacheUpdated: 'cacheUpdated',
  organizationId: 'organizationId',
  teamId: 'teamId',
  userId: 'userId',
  teamRole: 'teamRole',
  login: 'login',
  avatar: 'avatar',
}

const fieldNames = Object.getOwnPropertyNames(Field);

export class TeamMemberCacheEntity implements ITeamMemberCacheProperties {
  uniqueId: string;
  cacheUpdated: Date;

  organizationId: string;
  teamId: string;
  userId: string;
  teamRole: GitHubTeamRole;

  login: string;
  avatar: string;

  public static GenerateIdentifier(organizationId: string, teamId: string, userId: string) {
    if (!organizationId) {
      throw new Error('organizationId required');
    }
    if (!teamId) {
      throw new Error('teamId required');
    }
    if (!userId) {
      throw new Error('userId required');
    }
    return `${organizationId}:${teamId}:${userId}`;
  }

  constructor() {
    this.cacheUpdated = new Date();
  }
}

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => { return new TeamMemberCacheEntity(); });
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, Field.uniqueId);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.MemoryMapping, new Map<string, string>([
  [Field.organizationId, 'orgid'],
  [Field.teamId, 'teamName'],
  [Field.userId, 'teamSlug'],
  [Field.uniqueId, 'uniqueId'],
  [Field.cacheUpdated, 'cached'],
  [Field.teamRole, 'role'],
  [Field.login, 'login'],
  [Field.avatar, 'avatar'],
]));
EntityMetadataMappings.RuntimeValidateMappings(type, MetadataMappingDefinition.MemoryMapping, fieldNames, []);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresDefaultTableName, 'teammembercache');
EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresDefaultTypeColumnName, 'teammembercache');
EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresMapping, new Map<string, string>([
  [Field.organizationId, (Field.organizationId as string).toLowerCase()],
  [Field.uniqueId, (Field.uniqueId as string).toLowerCase()],
  [Field.teamId, (Field.teamId as string).toLowerCase()],
  [Field.userId, (Field.userId as string).toLowerCase()],
  [Field.cacheUpdated, (Field.cacheUpdated as string).toLowerCase()],
  [Field.teamRole, (Field.teamRole as string).toLowerCase()],
  [Field.login, (Field.login as string).toLowerCase()],
  [Field.avatar, (Field.avatar as string).toLowerCase()],
]));
EntityMetadataMappings.RuntimeValidateMappings(type, MetadataMappingDefinition.PostgresMapping, fieldNames, []);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresQueries, (query: IEntityMetadataFixedQuery, mapMetadataPropertiesToFields: string[], metadataColumnName: string, tableName: string, getEntityTypeColumnValue) => {
  const entityTypeColumn = mapMetadataPropertiesToFields[EntityField.Type];
  const orgIdColumn = mapMetadataPropertiesToFields[Field.organizationId];
  const entityTypeValue = getEntityTypeColumnValue(type);
  let sql = '', values = [];
  switch (query.fixedQueryType) {
    case FixedQueryType.TeamMemberCacheGetAll:
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
    case FixedQueryType.TeamMemberCacheGetByOrganizationId:
      const { organizationId } = query as TeamMemberCacheFixedQueryByOrganizationId;
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
      throw new Error(`The fixed query type "${query.fixedQueryType}" is not implemented by this provider for the type ${type}, or is of an unknown type`);
  }
});

EntityMetadataMappings.Register(type, MetadataMappingDefinition.MemoryQueries, (query: IEntityMetadataFixedQuery, allInTypeBin: IEntityMetadata[]) => {
  switch (query.fixedQueryType) {
    case FixedQueryType.TeamMemberCacheGetAll:
      return allInTypeBin;

    case FixedQueryType.TeamMemberCacheGetByOrganizationId:
      const { organizationId } = query as TeamMemberCacheFixedQueryByOrganizationId;
      if (!organizationId) {
        throw new Error('organizationId required');
      }
      throw new Error('Not implemented yet');
    default:
      throw new Error(`The fixed query type "${query.fixedQueryType}" is not implemented by this provider for the type ${type}, or is of an unknown type`);
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
  Type: type,
  EnsureDefinitions: () => {},
};
