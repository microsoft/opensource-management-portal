//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { v4 } from 'uuid';

import { IEntityMetadata, EntityMetadataType, IEntityMetadataBaseOptions, EntityMetadataBase } from '../../lib/entityMetadataProvider/entityMetadata';
import { IEntityMetadataFixedQuery, QueryBase } from '../../lib/entityMetadataProvider/query';
import { EntityMetadataMappings, MetadataMappingDefinition } from '../../lib/entityMetadataProvider/declarations';
import { PostgresSettings, PostgresConfiguration } from '../../lib/entityMetadataProvider/postgres';
import { IDictionary } from '../../transitional';
import { MemorySettings } from '../../lib/entityMetadataProvider/memory';

const type = new EntityMetadataType('EventRecord');
const thisProviderType = type;

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
  updated: any;
  additionalData: any;
  isOpenContribution: any;
}

const eventId = 'eventId';

class EventQueryBase extends QueryBase<EventRecord> {
  constructor(public query: Query) {
    super();
  }
}

class EventQuery<T> extends EventQueryBase {
  constructor(query: Query, public parameters: T) {
    super(query);
    if (!this.parameters) {
      this.parameters = {} as T;
    }
  }
}

enum Query {
  ContributionsByThirdPartyId = 'ContributionsByThirdPartyId',
  ContributionsByThirdPartyIdDateRange = 'ContributionsByThirdPartyIdDateRange',
  ContributionsByCorporateIdDateRange = 'ContributionsByCorporateIdDateRange',
  ContributionsByDateRange = 'ContributionsByDateRange',
  DistinctEligibleContributorsByDateRange = 'DistinctEligibleContributorsByDateRange',
  DistinctOrganizations = 'DistinctOrganizations',
  PopularContributionsByDateRange = 'PopularContributionsByDateRange',
}

interface NoParameters {}
interface ParameterThirdPartyId {
  thirdPartyId: string;
}
interface ParameterCorporateId {
  corporateId: string;
}
interface ParametersStartEndDates {
  start: Date;
  end: Date;
}
interface ParameterContributionsLimiter {
  limitToOpenContributionsOnly: boolean;
}
interface ParametersThirdPartyIdDateRange 
  extends ParameterThirdPartyId, ParametersStartEndDates, ParameterContributionsLimiter {}
  interface ParametersCorporateIdDateRange 
  extends ParameterCorporateId, ParametersStartEndDates, ParameterContributionsLimiter {}

const Field: IEventRecordProperties = {
  // eventId: 'eventId',
  action: 'action',
  created: 'created',
  inserted: 'inserted',
  updated: 'updated',
  organizationName: 'organizationName',
  organizationId: 'organizationId',
  repositoryName: 'repositoryName',
  repositoryId: 'repositoryId',
  userUsername: 'userUsername',
  userId: 'userId',
  userCorporateId: 'userCorporateId',
  userCorporateUsername: 'userCorporateUsername',
  additionalData: 'additionalData',
  isOpenContribution: 'isOpenContribution',
}

const fieldNames = Object.getOwnPropertyNames(Field);
const nativeFieldNames = fieldNames.filter(x => x !== Field.additionalData);

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
  updated: Date;

  userUsername: string;
  userId: string;
  userCorporateId: string;
  userCorporateUsername: string;

  isOpenContribution: boolean;

  constructor() {
    this.eventId = v4();
  }
}

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => { return new EventRecord(); });
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, eventId);

EntityMetadataMappings.Register(type, MemorySettings.MemoryMapping, new Map<string, string>([
  [Field.action, (Field.action).toLowerCase()],
  [Field.additionalData, (Field.additionalData).toLowerCase()],
  [Field.inserted, (Field.inserted).toLowerCase()],
  [Field.created, (Field.created).toLowerCase()],
  [Field.updated, (Field.updated).toLowerCase()],
  [Field.repositoryId, (Field.repositoryId).toLowerCase()],
  [Field.repositoryName, (Field.repositoryName).toLowerCase()],
  [Field.organizationId, (Field.organizationId).toLowerCase()],
  [Field.organizationName, (Field.organizationName).toLowerCase()],
  [Field.userId, (Field.userId).toLowerCase()],
  [Field.userUsername, (Field.userUsername).toLowerCase()],
  [Field.userCorporateId, (Field.userCorporateId).toLowerCase()],
  [Field.userCorporateUsername, (Field.userCorporateUsername).toLowerCase()],
  [Field.isOpenContribution, (Field.isOpenContribution).toLowerCase()],
]));
EntityMetadataMappings.RuntimeValidateMappings(type, MemorySettings.MemoryMapping, fieldNames, [eventId]);

PostgresConfiguration.SetDefaultTableName(type, 'events');
EntityMetadataMappings.Register(type, PostgresSettings.PostgresDefaultTypeColumnName, 'event');
PostgresConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
PostgresConfiguration.IdentifyNativeFields(type, nativeFieldNames);
PostgresConfiguration.ValidateMappings(type, fieldNames, [eventId]);

EntityMetadataMappings.Register(type, PostgresSettings.PostgresQueries, (query: IEntityMetadataFixedQuery, mapMetadataPropertiesToFields: string[], metadataColumnName: string, tableName: string, getEntityTypeColumnValue) => {
  // const entityTypeColumn = mapMetadataPropertiesToFields[EntityField.Type];
  // const entityTypeValue = getEntityTypeColumnValue(type);
  const base = query as EventQueryBase;
  switch (base.query) {
    case Query.DistinctOrganizations: {
      return {
        sql: `
          SELECT
            DISTINCT organizationname
          FROM
            ${tableName}
          ORDER BY
            organizationname`, 
        values: [],
        skipEntityMapping: true,
      };
    }
    case Query.PopularContributionsByDateRange: {
      const { start, end } = (base as EventQuery<ParametersStartEndDates>).parameters;
      return {
        sql: (`
          SELECT
            repositoryid,
            repositoryname,
            COUNT (repositoryid) as count
          FROM
            ${tableName}
          WHERE
                isopencontribution = True
            AND created >= $1
            AND created < $2
          GROUP BY
            repositoryid, repositoryname
          ORDER BY 
            count DESC
          LIMIT
            500
          `),
        values: [
          start,
          end,
        ],
        skipEntityMapping: true,
      };
    }
    case Query.DistinctEligibleContributorsByDateRange: {
      const { start, end } = (base as EventQuery<ParametersStartEndDates>).parameters;
      return {
        sql: (`
          SELECT
            DISTINCT(userid) as userid
          FROM
            ${tableName}
          WHERE
              isopencontribution = True
          AND created >= $1
          AND created < $2
          `),
        values: [
          start,
          end,
        ],
        skipEntityMapping: true,
      };
    }
    case Query.ContributionsByThirdPartyId: {
      const { thirdPartyId } = (base as EventQuery<ParameterThirdPartyId>).parameters;
      if (!thirdPartyId) {
        throw new Error('thirdPartyId required');
      }
      return {
        sql: (`
          SELECT
            *
          FROM
            ${tableName}
          WHERE
              userid = $1
          `),
        values: [
          thirdPartyId,
        ]
      };
    }
    case Query.ContributionsByCorporateIdDateRange: {
      const { corporateId, start, end, limitToOpenContributionsOnly } = (base as EventQuery<ParametersCorporateIdDateRange>).parameters;
      if (!corporateId) {
        throw new Error('corporateId required');
      }
      if (!start) {
        throw new Error('start required');
      }
      if (!end) {
        throw new Error('end required');
      }
      return {
        sql: (`
          SELECT
            *
          FROM
            ${tableName}
          WHERE
              usercorporateid = $1
          ${limitToOpenContributionsOnly ? '' : '-- '} AND isopencontribution = True
          AND created >= $2
          AND created < $3
          ORDER BY
            created DESC
          `),
        values: [
          corporateId,
          start,
          end,
        ]
      };
    }
    case Query.ContributionsByThirdPartyIdDateRange: {
      const { thirdPartyId, start, end, limitToOpenContributionsOnly } = (base as EventQuery<ParametersThirdPartyIdDateRange>).parameters;
      if (!thirdPartyId) {
        throw new Error('thirdPartyId required');
      }
      if (!start) {
        throw new Error('start required');
      }
      if (!end) {
        throw new Error('end required');
      }
      return {
        sql: (`
          SELECT *
          FROM
            ${tableName}
          WHERE
              userid = $1
          ${limitToOpenContributionsOnly ? '' : '-- '} AND isopencontribution = True
          AND created >= $2
          AND created < $3
          ORDER BY
            created DESC
          `),
        values: [
          thirdPartyId,
          start,
          end,
        ]
      };
    }
    case Query.ContributionsByDateRange: {
      const { start, end } = (base as EventQuery<ParametersStartEndDates>).parameters;
      if (!start) {
        throw new Error('start required');
      }
      if (!end) {
        throw new Error('end required');
      }
      return {
        sql: (`
          SELECT *
          FROM
            ${tableName}
          WHERE
              isopencontribution = True
          AND created >= $1
          AND created < $2
          ORDER BY
            created DESC
          `),
        values: [
          start,
          end,
        ]
      };
    }
    default:
      throw new Error(`The query ${base.query} is not implemented by this provider for the type ${type}`);
  }
});

EntityMetadataMappings.Register(type, MemorySettings.MemoryQueries, (query: IEntityMetadataFixedQuery, allInTypeBin: IEntityMetadata[]) => {
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

export interface IEventRecordProviderCreateOptions extends IEntityMetadataBaseOptions { }

export interface IEventRecordProvider {
  initialize(): Promise<void>;
  getEvent(recordId: string): Promise<EventRecord>;
  insertEvent(record: EventRecord): Promise<string>;
  rewriteEvent(record: EventRecord): Promise<void>;

  queryEventsByThirdPartyId(thirdPartyId: string): Promise<EventRecord[]>;
  queryOpenContributionEventsByDateRange(startDate: Date, endDate: Date): Promise<EventRecord[]>;
  queryOpenContributionEventsByDateRangeAndThirdPartyId(thirdPartyId: string, startDate: Date, endDate: Date, limitToOpenContributionsOnly: boolean): Promise<EventRecord[]>;
  queryOpenContributionEventsByDateRangeAndCorporateId(corporateId: string, startDate: Date, endDate: Date, limitToOpenContributionsOnly: boolean): Promise<EventRecord[]>;
  queryDistinctEligibleContributors(startDate: Date, endDate: Date): Promise<string[]>;
  queryDistinctOrganizations(): Promise<string[]>;
  queryPopularContributions(startDate: Date, endDate: Date): Promise<any[]>;
}

export class EventRecordProvider extends EntityMetadataBase implements IEventRecordProvider {
  constructor(options: IEventRecordProviderCreateOptions) {
    super(options);
    EntityImplementation.EnsureDefinitions();
  }

  async rewriteEvent(metadata: EventRecord): Promise<void> {
    const entity = this.serialize(thisProviderType, metadata);
    await this._entities.updateMetadata(entity);
  }

  async getEvent(eventId: string): Promise<EventRecord> {
    this.ensureHelpers(thisProviderType);
    let metadata: IEntityMetadata = null;
    metadata = await this._entities.getMetadata(thisProviderType, eventId);
    return this.deserialize<EventRecord>(thisProviderType, metadata);
  }

  async insertEvent(record: EventRecord): Promise<string> {
    const entity = this.serialize(thisProviderType, record);
    await this._entities.setMetadata(entity);
    return entity.entityId;
  }

  async queryEventsByThirdPartyId(thirdPartyId: string): Promise<EventRecord[]> {
    const query = new EventQuery<ParameterThirdPartyId>(Query.ContributionsByThirdPartyId, { thirdPartyId });
    const metadatas = await this._entities.fixedQueryMetadata(thisProviderType, query);
    const results = this.deserializeArray<EventRecord>(thisProviderType, metadatas);
    return results;
  }

  async queryOpenContributionEventsByDateRange(start: Date, end: Date): Promise<EventRecord[]> {
    const query = new EventQuery<ParametersStartEndDates>(Query.ContributionsByDateRange, { start, end });
    const metadatas = await this._entities.fixedQueryMetadata(thisProviderType, query);
    const results = this.deserializeArray<EventRecord>(thisProviderType, metadatas);
    return results;
  }

  async queryOpenContributionEventsByDateRangeAndThirdPartyId(thirdPartyId: string, start: Date, end: Date, limitToOpenContributionsOnly: boolean): Promise<EventRecord[]> {
    const query = new EventQuery<ParametersThirdPartyIdDateRange>(Query.ContributionsByThirdPartyIdDateRange, {
      start, end, thirdPartyId, limitToOpenContributionsOnly });
    const metadatas = await this._entities.fixedQueryMetadata(thisProviderType, query);
    const results = this.deserializeArray<EventRecord>(thisProviderType, metadatas);
    return results;
  }
  
  async queryOpenContributionEventsByDateRangeAndCorporateId(corporateId: string, start: Date, end: Date, limitToOpenContributionsOnly: boolean): Promise<EventRecord[]> {
    const query = new EventQuery<ParametersCorporateIdDateRange>(Query.ContributionsByCorporateIdDateRange, {
      start, end, corporateId, limitToOpenContributionsOnly });
    const metadatas = await this._entities.fixedQueryMetadata(thisProviderType, query);
    const results = this.deserializeArray<EventRecord>(thisProviderType, metadatas);
    return results;
  }

  async queryDistinctEligibleContributors(start: Date, end: Date): Promise<string[]> {
    const query = new EventQuery<ParametersStartEndDates>(Query.DistinctEligibleContributorsByDateRange, { start, end });
    const results = await this._entities.fixedQueryMetadata(thisProviderType, query);
    return results.map(row => row['userid']);
  }

  async queryPopularContributions(start: Date, end: Date): Promise<any[]> {
    const query = new EventQuery<ParametersStartEndDates>(Query.PopularContributionsByDateRange, { start, end });
    const results = await this._entities.fixedQueryMetadata(thisProviderType, query);
    return results as any[];
  }

  async queryDistinctOrganizations(): Promise<string[]> {
    const query = new EventQuery<NoParameters>(Query.DistinctOrganizations, null);
    const results = await this._entities.fixedQueryMetadata(thisProviderType, query);
    return results.map(row => row['organizationname']);
  }
}

export const EntityImplementation = {
  Type: type,
  EnsureDefinitions: () => {},
};
