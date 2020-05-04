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

const type = new EntityMetadataType('ElectionNomination');

const postgresTableName = 'voting';
const columnTypeName = 'nomination';

class NominationQueryBase extends QueryBase<ElectionNominationEntity> {
  constructor(public query: Query) {
    super();
  }
}

class NominationQuery<T> extends NominationQueryBase {
  constructor(query: Query, public parameters: T) {
    super(query);
    if (!this.parameters) {
      this.parameters = {} as T;
    }
  }
}

enum Query {
  ApprovedElectionNominees = 'ApprovedElectionNominees',
  AllNominees = 'AllNominees',
}

interface ParameterElectionId {
  electionId: string;
}

interface IElectionNominationProperties {
  // THIS IS THE PRIMARY ID: nominationId: any;
  electionId: any;
  uniqueId: any;           // The unique ID identifies the nominee without any user-based information
  approved: any;           // Only approved nominations appear on a ballot
  title: any;              // Project or nominee headline
  corporateId: any;
  web: any;                // URL to the project or repo
  justification: any;      // Original nomination description
  description: any;        // Visible description of the nomination for voters
}

const nominationId = 'nominationId';

const Field: IElectionNominationProperties = {
  // nominationId: 'nominationId',
  uniqueId: 'uniqueId',
  electionId: 'electionId',
  approved: 'approved',
  title: 'title',
  corporateId: 'corporateId',
  web: 'web',
  justification: 'justification',
  description: 'description',
}

const fieldNames = Object.getOwnPropertyNames(Field);

export class ElectionNominationEntity implements IElectionNominationProperties {
  nominationId: string;
  uniqueId: string;

  electionId: string;
  approved: boolean;
  title: string;
  corporateId: string;

  web: string;
  justification: string;
  description: string;

  constructor() {
    this.nominationId = '';
    this.uniqueId = v4();
  }

  static GetNominationId(corporateId: string, electionId: string) {
    return `n-${electionId}-${corporateId}`;
  }

  static CreateNomination(corporateId: string, electionId: string): ElectionNominationEntity {
    const nomination = new ElectionNominationEntity();
    nomination.nominationId = this.GetNominationId(corporateId, electionId);
    return nomination;
  }
}

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => { return new ElectionNominationEntity(); });
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, nominationId);

PostgresConfiguration.SetDefaultTableName(type, postgresTableName);
EntityMetadataMappings.Register(type, PostgresSettings.PostgresDefaultTypeColumnName, columnTypeName);
PostgresConfiguration.MapFieldsToColumnNames(type, new Map<string, string>([
  [Field.electionId, (Field.electionId).toLowerCase()],
  [Field.uniqueId, (Field.uniqueId).toLowerCase()],
  [Field.approved, (Field.approved).toLowerCase()],
  [Field.title, (Field.title).toLowerCase()],
  [Field.corporateId, (Field.corporateId).toLowerCase()],
  [Field.web, (Field.web).toLowerCase()],
  [Field.justification, (Field.justification).toLowerCase()],
  [Field.description, (Field.description).toLowerCase()],
]));
PostgresConfiguration.ValidateMappings(type, fieldNames, [nominationId]);

EntityMetadataMappings.Register(type, PostgresSettings.PostgresQueries, (query: IEntityMetadataFixedQuery, mapMetadataPropertiesToFields: string[], metadataColumnName: string, tableName: string, getEntityTypeColumnValue) => {
  const entityTypeColumn = mapMetadataPropertiesToFields[EntityField.Type];
  const entityTypeValue = getEntityTypeColumnValue(type);
  const base = query as NominationQueryBase;
  switch (base.query) {
    case Query.AllNominees: {
      const parameters = (base as NominationQuery<ParameterElectionId>).parameters;
      return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
        electionid: parameters.electionId,
      });
    }
    case Query.ApprovedElectionNominees: {
      const parameters = (base as NominationQuery<ParameterElectionId>).parameters;
      return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
        approved: true,
        electionid: parameters.electionId,
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

export interface IElectionNominationEntityProvider {
  getNomination(nominationId: string): Promise<ElectionNominationEntity>;
  insertNomination(record: ElectionNominationEntity): Promise<string>;
  updateNomination(record: ElectionNominationEntity): Promise<void>;
  queryApprovedElectionNominees(electionId: string): Promise<ElectionNominationEntity[]>;
  queryAllElectionNominees(electionId: string): Promise<ElectionNominationEntity[]>;
}

export class ElectionNominationEntityProvider extends EntityMetadataBase implements IElectionNominationEntityProvider {
  constructor(options: IEntityMetadataBaseOptions) {
    super(options);
    EntityImplementation.EnsureDefinitions();
  }

  async updateNomination(metadata: ElectionNominationEntity): Promise<void> {
    const entity = this.serialize(thisProviderType, metadata);
    await this._entities.updateMetadata(entity);
  }

  async getNomination(nominationId: string): Promise<ElectionNominationEntity> {
    this.ensureHelpers(thisProviderType);
    let metadata: IEntityMetadata = null;
    metadata = await this._entities.getMetadata(thisProviderType, nominationId);
    return this.deserialize<ElectionNominationEntity>(thisProviderType, metadata);
  }

  async insertNomination(nomination: ElectionNominationEntity): Promise<string> {
    const entity = this.serialize(thisProviderType, nomination);
    await this._entities.setMetadata(entity);
    return entity.entityId;
  }

  queryApprovedElectionNominees(electionId: string): Promise<ElectionNominationEntity[]> {
    const query = new NominationQuery<ParameterElectionId>(Query.ApprovedElectionNominees, { electionId });
    return query.discover(this, this._entities, thisProviderType);
  }

  queryAllElectionNominees(electionId: string): Promise<ElectionNominationEntity[]> {
    const query = new NominationQuery<ParameterElectionId>(Query.AllNominees, { electionId });
    return query.discover(this, this._entities, thisProviderType);
  }
}
