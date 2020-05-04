//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { EntityField} from '../../lib/entityMetadataProvider/entityMetadataProvider';
import { IEntityMetadata, EntityMetadataType, EntityMetadataBase, IEntityMetadataBaseOptions } from '../../lib/entityMetadataProvider/entityMetadata';
import { IEntityMetadataFixedQuery, FixedQueryType, QueryBase } from '../../lib/entityMetadataProvider/query';
import { EntityMetadataMappings, MetadataMappingDefinition } from '../../lib/entityMetadataProvider/declarations';
import { PostgresJsonEntityQuery, PostgresSettings, PostgresConfiguration } from '../../lib/entityMetadataProvider/postgres';
import { v4 } from 'uuid';

export enum ElectionEligibilityType {
  OpenSourceContributions = 'opensourcecontributions',
}

const type = new EntityMetadataType('Election');

const postgresTableName = 'voting';
const columnTypeName = 'election';

class ElectionQueryBase extends QueryBase<ElectionEntity> {
  constructor(public query: Query) {
    super();
  }
}

class ElectionQuery<T> extends ElectionQueryBase {
  constructor(query: Query, public parameters: T) {
    super(query);
    if (!this.parameters) {
      this.parameters = {} as T;
    }
  }
}

enum Query {
  ActiveElections = 'ActiveElections',
  BySlug = 'BySlug',
  ByEligibilityDates = 'ByEligibilityDates',
}

interface NoParameters {}
interface ParameterElectionSlug { slug: string }
interface ParametersElectionEligibilityDates {
  start: Date;
  end: Date
}

interface IElectionProperties {
  // THIS IS THE PRIMARY ID: electionId: any;
  active: any;
  title: any;
  slug: any;
  eligibilityType: any;
  description: any;
  votingStart: any;
  votingEnd: any;
  eligibilityStart: any;
  eligibilityEnd: any;
  nominationStart: any;
  nominationEnd: any;
}

const electionId = 'electionId';

const Field: IElectionProperties = {
  // electionId: 'electionId',
  active: 'active',
  title: 'title',
  slug: 'slug',
  eligibilityType: 'eligibilityType',
  description: 'description',
  votingStart: 'votingStart',
  votingEnd: 'votingEnd',
  eligibilityStart: 'eligibilityStart',
  eligibilityEnd: 'eligibilityEnd',
  nominationStart: 'nominationStart',
  nominationEnd: 'nominationEnd',
}

const fieldNames = Object.getOwnPropertyNames(Field);

export class ElectionEntity implements IElectionProperties {
  electionId: string;

  active: boolean;
  title: string;
  slug: string;
  eligibilityType: ElectionEligibilityType;
  description: string;
  votingStart: Date;
  votingEnd: Date;
  eligibilityStart: Date;
  eligibilityEnd: Date;
  nominationStart: Date;
  nominationEnd: Date;

  constructor() {
    this.electionId = v4();
  }
}

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => { return new ElectionEntity(); });
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, electionId);

PostgresConfiguration.SetDefaultTableName(type, postgresTableName);
EntityMetadataMappings.Register(type, PostgresSettings.PostgresDefaultTypeColumnName, columnTypeName);
PostgresConfiguration.MapFieldsToColumnNames(type, new Map<string, string>([
  [Field.active, (Field.active).toLowerCase()],
  [Field.title, (Field.title).toLowerCase()],
  [Field.slug, (Field.slug).toLowerCase()],
  [Field.eligibilityType, (Field.eligibilityType).toLowerCase()],
  [Field.description, (Field.description).toLowerCase()],
  [Field.votingStart, (Field.votingStart).toLowerCase()],
  [Field.votingEnd, (Field.votingEnd).toLowerCase()],
  [Field.eligibilityStart, (Field.eligibilityStart).toLowerCase()],
  [Field.eligibilityEnd, (Field.eligibilityEnd).toLowerCase()],
  [Field.nominationStart, (Field.nominationStart).toLowerCase()],
  [Field.nominationEnd, (Field.nominationEnd).toLowerCase()],
]));
PostgresConfiguration.ValidateMappings(type, fieldNames, [electionId]);

EntityMetadataMappings.Register(type, PostgresSettings.PostgresQueries, (query: IEntityMetadataFixedQuery, mapMetadataPropertiesToFields: string[], metadataColumnName: string, tableName: string, getEntityTypeColumnValue) => {
  const entityTypeColumn = mapMetadataPropertiesToFields[EntityField.Type];
  const entityTypeValue = getEntityTypeColumnValue(type);
  const base = query as ElectionQueryBase;
  switch (base.query) {
    case Query.ActiveElections: {
      const parameters = (base as ElectionQuery<ParameterElectionSlug>).parameters;
      return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
        slug: parameters.slug,
      });
    }
    case Query.ByEligibilityDates: {
      const parameters = (base as ElectionQuery<ParametersElectionEligibilityDates>).parameters;
      return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
        eligibilitystart: parameters.start,
        eligibilityend: parameters.end,
      });
    }
    case Query.ActiveElections: {
      const parameters = (base as ElectionQuery<NoParameters>).parameters;
      return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
        active: true,
      });
    }
    default:
      throw new Error(`The query ${base.query} is not implemented by this provider for the type ${type}`);
  }
});

// Runtime validation of FieldNames
for (let i = 0; i < fieldNames.length; i++) {
  const fn = fieldNames[i];
  if (Field[fn] !== fn) {
    throw new Error(`Field name ${fn} and value do not match in ${__filename}`);
  }
}

const EntityImplementation = {
  Type: type,
  EnsureDefinitions: () => {},
};

const thisProviderType = EntityImplementation.Type;

export interface IElectionEntityProvider {
  getElection(electionId: string): Promise<ElectionEntity>;
  insertElection(record: ElectionEntity): Promise<string>;
  updateElection(record: ElectionEntity): Promise<void>;
  queryActiveElections(): Promise<ElectionEntity[]>;
  queryElectionBySlug(slug: string): Promise<ElectionEntity[]>;
  queryElectionsByEligibilityDates(start: Date, end: Date): Promise<ElectionEntity[]>;
  deleteElection(metadata: ElectionEntity): Promise<void>;
}

export class ElectionProvider extends EntityMetadataBase implements IElectionEntityProvider {
  constructor(options: IEntityMetadataBaseOptions) {
    super(options);
    EntityImplementation.EnsureDefinitions();
  }

  async updateElection(metadata: ElectionEntity): Promise<void> {
    const entity = this.serialize(thisProviderType, metadata);
    await this._entities.updateMetadata(entity);
  }

  async getElection(eventId: string): Promise<ElectionEntity> {
    this.ensureHelpers(thisProviderType);
    let metadata: IEntityMetadata = null;
    metadata = await this._entities.getMetadata(thisProviderType, eventId);
    return this.deserialize<ElectionEntity>(thisProviderType, metadata);
  }

  async insertElection(record: ElectionEntity): Promise<string> {
    const entity = this.serialize(thisProviderType, record);
    await this._entities.setMetadata(entity);
    return entity.entityId;
  }

  queryActiveElections(): Promise<ElectionEntity[]> {
    const query = new ElectionQuery<NoParameters>(Query.ActiveElections, null);
    return query.discover(this, this._entities, thisProviderType);
  }

  queryElectionBySlug(slug: string): Promise<ElectionEntity[]> {
    const query = new ElectionQuery<ParameterElectionSlug>(Query.ActiveElections, { slug });
    return query.discover(this, this._entities, thisProviderType);
  }

  queryElectionsByEligibilityDates(start: Date, end: Date): Promise<ElectionEntity[]> {
    const query = new ElectionQuery<ParametersElectionEligibilityDates>(Query.ByEligibilityDates, { start, end });
    return query.discover(this, this._entities, thisProviderType);
  }

  async deleteElection(metadata: ElectionEntity): Promise<void> {
    const entity = this.serialize(thisProviderType, metadata);
    await this._entities.deleteMetadata(entity);
  }
}
