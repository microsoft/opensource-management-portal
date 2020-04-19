//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { EntityField} from '../../lib/entityMetadataProvider/entityMetadataProvider';
import { IEntityMetadata } from '../../lib/entityMetadataProvider/entityMetadata';
import { IEntityMetadataFixedQuery, FixedQueryType } from '../../lib/entityMetadataProvider/query';
import { EntityMetadataMappings, MetadataMappingDefinition } from '../../lib/entityMetadataProvider/declarations';
import { Type } from './type';
import { PostgresJsonEntityQuery } from '../../lib/entityMetadataProvider/postgres';
import { IDictionary } from '../../transitional';
import { v4 } from 'uuid';
import { stringOrNumberAsString } from '../../utils';

const type = Type;

interface IEventRecordProperties {
  // THIS IS THE PRIMARY ID: eventId: any;
  action: any;
  userUsername: any;
  userId: any;
  userCorporateId: any;
  userCorporateUsername: any;
  organizationName: any;
  organizationId: any;
  repositoryName: any;
  repositoryId: any;
  created: any;
  inserted: any;
  additionalData: any;
}

const eventId = 'eventId';

const Field: IEventRecordProperties = {
  // eventId: 'eventId',
  action: 'action',
  created: 'created',
  inserted: 'inserted',
  organizationName: 'organizationName',
  organizationId: 'organizationId',
  repositoryName: 'repositoryName',
  repositoryId: 'repositoryId',
  userUsername: 'userUsername',
  userId: 'userId',
  userCorporateId: 'userCorporateId',
  userCorporateUsername: 'userCorporateUsername',
  additionalData: 'additionalData',
}

const fieldNames = Object.getOwnPropertyNames(Field);

export class EventRecord implements IEventRecordProperties {
  eventId: string;

  action: string;

  additionalData: IDictionary<any>;

  repositoryId: string;
  repositoryName: string;

  organizationId: string;
  organizationName: string;

  created: Date;
  inserted: Date;

  userUsername: string;
  userId: string;
  userCorporateId: string;
  userCorporateUsername: string;

  constructor() {
    this.eventId = v4();
  }
}

export class EventRecordDistinctOrganizations implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.EventRecordDistinctOrganizations;
}

export class EventRecordQueryContributionEventsByThirdPartyId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.EventRecordContributionsByThirdPartyId;
  constructor(public thirdPartyId: string) {
  }
}

export class EventRecordQueryContributionEventsByDateRangeAndId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.EventRecordContributionsByDateRangeAndId;
  constructor(public startDate: Date, public endDate: Date, public thirdPartyId: string, public limitToOpenContributionsOnly: boolean) {
  }
}

export class EventRecordQueryContributionEventsByDateRangeAndCorporateId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.EventRecordContributionsByDateRangeAndCorporateId;
  constructor(public startDate: Date, public endDate: Date, public corporateId: string, public limitToOpenContributionsOnly: boolean) {
  }
}

export class EventRecordPopularContributionsByRange implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.EventRecordPopularContributionsByDateRange;
  constructor(public startDate: Date, public endDate: Date) {
  }
}

export class EventRecordQueryRecordEligibleContributorsByRange implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.EventRecordDistinctEligibleContributorsByDateRange;
  constructor(public startDate: Date, public endDate: Date) {
  }
}

export class EventRecordQueryContributionEventsByDateRange implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.EventRecordContributionsByDateRange;
  constructor(public startDate: Date, public endDate: Date) {
  }
}

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => { return new EventRecord(); });
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, eventId);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.MemoryMapping, new Map<string, string>([
  [Field.action, (Field.action).toLowerCase()],
  [Field.additionalData, (Field.additionalData).toLowerCase()],
  [Field.inserted, (Field.inserted).toLowerCase()],
  [Field.created, (Field.created).toLowerCase()],
  [Field.repositoryId, (Field.repositoryId).toLowerCase()],
  [Field.repositoryName, (Field.repositoryName).toLowerCase()],
  [Field.organizationId, (Field.organizationId).toLowerCase()],
  [Field.organizationName, (Field.organizationName).toLowerCase()],
  [Field.userId, (Field.userId).toLowerCase()],
  [Field.userUsername, (Field.userUsername).toLowerCase()],
  [Field.userCorporateId, (Field.userCorporateId).toLowerCase()],
  [Field.userCorporateUsername, (Field.userCorporateUsername).toLowerCase()],
]));
EntityMetadataMappings.RuntimeValidateMappings(type, MetadataMappingDefinition.MemoryMapping, fieldNames, [eventId]);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresDefaultTableName, 'events');
EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresDefaultTypeColumnName, 'eventid');
EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresMapping, new Map<string, string>([
  [Field.action, (Field.action).toLowerCase()],
  [Field.additionalData, (Field.additionalData).toLowerCase()],
  [Field.inserted, (Field.inserted).toLowerCase()],
  [Field.created, (Field.created).toLowerCase()],
  [Field.repositoryId, (Field.repositoryId).toLowerCase()],
  [Field.repositoryName, (Field.repositoryName).toLowerCase()],
  [Field.organizationId, (Field.organizationId).toLowerCase()],
  [Field.organizationName, (Field.organizationName).toLowerCase()],
  [Field.userId, (Field.userId).toLowerCase()],
  [Field.userUsername, (Field.userUsername).toLowerCase()],
  [Field.userCorporateId, (Field.userCorporateId).toLowerCase()],
  [Field.userCorporateUsername, (Field.userCorporateUsername).toLowerCase()],
]));
EntityMetadataMappings.RuntimeValidateMappings(type, MetadataMappingDefinition.PostgresMapping, fieldNames, [eventId]);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresQueries, (query: IEntityMetadataFixedQuery, mapMetadataPropertiesToFields: string[], metadataColumnName: string, tableName: string, getEntityTypeColumnValue) => {
  const entityTypeColumn = mapMetadataPropertiesToFields[EntityField.Type];
  const entityTypeValue = getEntityTypeColumnValue(type);
  switch (query.fixedQueryType) {
    case FixedQueryType.EventRecordDistinctOrganizations: {
      return {
        sql: `SELECT DISTINCT ${metadataColumnName}->>'organizationname' AS orgname FROM ${tableName}`, 
        values: [],
        skipEntityMapping: true,
      };
    }
    case FixedQueryType.EventRecordPopularContributionsByDateRange: {
      const { startDate, endDate } = query as EventRecordPopularContributionsByRange;
      return {
        sql: (`
          SELECT
            (${metadataColumnName}->'repositoryid') as repositoryid,
            (${metadataColumnName}->'repositoryname') as repositoryname,
            COUNT ((${metadataColumnName}->'repositoryid')) as count
          FROM
            ${tableName}
          WHERE
                (${metadataColumnName}->'additionaldata'->>'contribution')::boolean = True
            AND (${metadataColumnName}->>'created')::timestamptz >= $1
            AND (${metadataColumnName}->>'created')::timestamptz < $2
          GROUP BY
            repositoryid, repositoryname
          ORDER BY 
            count DESC
          LIMIT 500
          `),
        values: [
          startDate,
          endDate,
        ],
        skipEntityMapping: true,
      };
    }
    case FixedQueryType.EventRecordDistinctEligibleContributorsByDateRange: {
      const { startDate, endDate } = query as EventRecordQueryRecordEligibleContributorsByRange;
      return {
        sql: (`
          SELECT DISTINCT(${metadataColumnName}->>'userid') as userid
          FROM ${tableName}
          WHERE
              (${metadataColumnName}->'additionaldata'->>'contribution')::boolean = True
          AND (${metadataColumnName}->>'created')::timestamptz >= $1
          AND (${metadataColumnName}->>'created')::timestamptz < $2
          `),
        values: [
          startDate,
          endDate,
        ],
        skipEntityMapping: true,
      };
    }
    case FixedQueryType.EventRecordContributionsByThirdPartyId: {
      const { thirdPartyId } = query as EventRecordQueryContributionEventsByThirdPartyId;
      if (!thirdPartyId) {
        throw new Error('thirdPartyId required');
      }
      return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
        userid: stringOrNumberAsString(thirdPartyId),
      }, Field.created.toLowerCase(), true);
    }
    case FixedQueryType.EventRecordContributionsByDateRangeAndCorporateId: {
      const { corporateId, startDate, endDate, limitToOpenContributionsOnly } = query as EventRecordQueryContributionEventsByDateRangeAndCorporateId;
      if (!corporateId) {
        throw new Error('corporateId required');
      }
      if (!startDate) {
        throw new Error('startDate required');
      }
      if (!endDate) {
        throw new Error('endDate required');
      }
      return {
        sql: (`
          SELECT *, (${metadataColumnName}->>'created')::timestamptz AS eventtime
          FROM ${tableName}
          WHERE
              (${metadataColumnName}->>'usercorporateid') = $1
          ${limitToOpenContributionsOnly ? '' : '-- '} AND (${metadataColumnName}->'additionaldata'->>'contribution')::boolean = True
          AND (${metadataColumnName}->>'created')::timestamptz >= $2
          AND (${metadataColumnName}->>'created')::timestamptz < $3
          ORDER BY eventtime DESC
          `),
        values: [
          corporateId,
          startDate,
          endDate,
        ]
      };
    }    case FixedQueryType.EventRecordContributionsByDateRangeAndId: {
      const { thirdPartyId, startDate, endDate, limitToOpenContributionsOnly } = query as EventRecordQueryContributionEventsByDateRangeAndId;
      if (!thirdPartyId) {
        throw new Error('thirdPartyId required');
      }
      if (!startDate) {
        throw new Error('startDate required');
      }
      if (!endDate) {
        throw new Error('endDate required');
      }
      return {
        sql: (`
          SELECT *, (${metadataColumnName}->>'created')::timestamptz AS eventtime
          FROM ${tableName}
          WHERE
              (${metadataColumnName}->>'userid') = $1
          ${limitToOpenContributionsOnly ? '' : '-- '} AND (${metadataColumnName}->'additionaldata'->>'contribution')::boolean = True
          AND (${metadataColumnName}->>'created')::timestamptz >= $2
          AND (${metadataColumnName}->>'created')::timestamptz < $3
          ORDER BY eventtime DESC
          `),
        values: [
          thirdPartyId,
          startDate,
          endDate,
        ]
      };
    }
    case FixedQueryType.EventRecordContributionsByDateRange: {
      const { startDate, endDate } = query as EventRecordQueryContributionEventsByDateRange;
      if (!startDate) {
        throw new Error('startDate required');
      }
      if (!endDate) {
        throw new Error('endDate required');
      }
      return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
        // TODO: date ranges here
        additionaldata: {
          contribution: true,
        }
      }, Field.created.toLowerCase(), true);
    }
    default:
      throw new Error(`The fixed query type "${query.fixedQueryType}" is not implemented by this provider for the type ${type}, or is of an unknown type`);
  }
});

EntityMetadataMappings.Register(type, MetadataMappingDefinition.MemoryQueries, (query: IEntityMetadataFixedQuery, allInTypeBin: IEntityMetadata[]) => {
  switch (query.fixedQueryType) {
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
