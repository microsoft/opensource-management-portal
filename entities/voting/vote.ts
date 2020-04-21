//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { v4 } from 'uuid';

import { EntityField} from '../../lib/entityMetadataProvider/entityMetadataProvider';
import { IEntityMetadata, EntityMetadataType, EntityMetadataBase, IEntityMetadataBaseOptions } from '../../lib/entityMetadataProvider/entityMetadata';
import { IEntityMetadataFixedQuery, FixedQueryType, QueryBase } from '../../lib/entityMetadataProvider/query';
import { EntityMetadataMappings, MetadataMappingDefinition } from '../../lib/entityMetadataProvider/declarations';
import { PostgresJsonEntityQuery } from '../../lib/entityMetadataProvider/postgres';

const type = new EntityMetadataType('ElectionVote');

const postgresTableName = 'voting';
const columnTypeName = 'vote';

export interface IElectionResult {
  nominationId: string;
  votes: number;
}

class VoteQueryBase extends QueryBase<ElectionVoteEntity> {
  constructor(public query: Query) {
    super();
  }
}

class VoteQuery<T> extends VoteQueryBase {
  constructor(query: Query, public parameters: T) {
    super(query);
    if (!this.parameters) {
      this.parameters = {} as T;
    }
  }
}

enum Query {
  VotesByCorporateId = 'VotesByCorporateId',
  VotesByElection = 'VotesByElection',
  ResultsByElection = 'ResultsByElection',
}

interface ParameterElectionId {
  electionId: string;
}

interface ParameterCorporateId {
  corporateId: string;
}

interface IElectionVoteProperties {
  // THIS IS THE PRIMARY ID: voteId: any;
  electionId: any;
  voted: any;
  nominationId: any;
  corporateId: any;
}

const voteId = 'voteId';

const Field: IElectionVoteProperties = {
  // voteId: 'voteId',
  electionId: 'electionId',
  voted: 'voted',
  nominationId: 'nominationId',
  corporateId: 'corporateId',
}

const fieldNames = Object.getOwnPropertyNames(Field);

export class ElectionVoteEntity implements IElectionVoteProperties {
  voteId: string;

  electionId: string;
  voted: Date;
  nominationId: string;
  corporateId: string;

  constructor() {
    this.voteId = v4();
  }

  static CreateVote(corporateId: string, electionId: string): ElectionVoteEntity {
    const obj = new ElectionVoteEntity();
    obj.voteId = this.GetVoteId(electionId, corporateId);
    obj.electionId = electionId;
    obj.corporateId = corporateId;
    obj.voted = new Date();
    return obj;
  }

  static GetVoteId(electionId: string, corporateId: string) {
    return `v-${corporateId}-${electionId}`;
  }
}

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => { return new ElectionVoteEntity(); });
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, voteId);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresDefaultTableName, postgresTableName);
EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresDefaultTypeColumnName, columnTypeName);
EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresMapping, new Map<string, string>([
  [Field.electionId, (Field.electionId).toLowerCase()],
  [Field.voted, (Field.voted).toLowerCase()],
  [Field.nominationId, (Field.nominationId).toLowerCase()],
  [Field.corporateId, (Field.corporateId).toLowerCase()],
]));
EntityMetadataMappings.RuntimeValidateMappings(type, MetadataMappingDefinition.PostgresMapping, fieldNames, [voteId]);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresQueries, (query: IEntityMetadataFixedQuery, mapMetadataPropertiesToFields: string[], metadataColumnName: string, tableName: string, getEntityTypeColumnValue) => {
  const entityTypeColumn = mapMetadataPropertiesToFields[EntityField.Type];
  const entityTypeValue = getEntityTypeColumnValue(type);
  const base = query as VoteQueryBase;
  switch (base.query) {
    case Query.VotesByCorporateId: {
      const parameters = (base as VoteQuery<ParameterCorporateId>).parameters;
      return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
        corporateid: parameters.corporateId,
      });
    }
    case Query.VotesByElection: {
      const parameters = (base as VoteQuery<ParameterElectionId>).parameters;
      return PostgresJsonEntityQuery(tableName, entityTypeColumn, entityTypeValue, metadataColumnName, {
        electionid: parameters.electionId,
      });
    }
    case Query.ResultsByElection: {
      const parameters = (base as VoteQuery<ParameterElectionId>).parameters;
      return {
        sql: (`
          SELECT
            (${metadataColumnName}->'nominationid') as nominationid,
            count( (${metadataColumnName}->'nominationid') ) as votes
          FROM
            ${tableName}
          WHERE
            ${entityTypeColumn} = $1 
            AND
            ${metadataColumnName} @> $2 
          GROUP BY
            (${metadataColumnName}->'nominationid')
          ORDER BY 
            votes DESC
          `),
        values: [
          entityTypeValue,
          { electionid: parameters.electionId },
        ],
        skipEntityMapping: true,
      };
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

export interface IElectionVoteEntityProvider {
  getVote(voteId: string): Promise<ElectionVoteEntity>;
  insertVote(voteEntity: ElectionVoteEntity): Promise<string>;

  queryElectionVotes(electionId: string): Promise<ElectionVoteEntity[]>;
  queryVotesByCorporateId(corporateId: string): Promise<ElectionVoteEntity[]>;
  currentElectionResults(electionId: string): Promise<IElectionResult[]>;
}

export class ElectionVoteProvider extends EntityMetadataBase implements IElectionVoteEntityProvider {
  constructor(options: IEntityMetadataBaseOptions) {
    super(options);
    EntityImplementation.EnsureDefinitions();
  }

  async getVote(voteId: string): Promise<ElectionVoteEntity> {
    this.ensureHelpers(thisProviderType);
    let metadata: IEntityMetadata = null;
    metadata = await this._entities.getMetadata(thisProviderType, voteId);
    return this.deserialize<ElectionVoteEntity>(thisProviderType, metadata);
  }

  async insertVote(voteEntity: ElectionVoteEntity): Promise<string> {
    const entity = this.serialize(thisProviderType, voteEntity);
    await this._entities.setMetadata(entity);
    return entity.entityId;
  }

  queryElectionVotes(electionId: string): Promise<ElectionVoteEntity[]> {
    const query = new VoteQuery<ParameterElectionId>(Query.VotesByElection, { electionId });
    return query.discover(this, this._entities, thisProviderType);
  }

  async currentElectionResults(electionId: string): Promise<IElectionResult[]> {
    const query = new VoteQuery<ParameterElectionId>(Query.ResultsByElection, { electionId });
    const results = await query.generic(this, this._entities, thisProviderType);
    return results.map(row => { return { nominationId: row.nominationid, votes: row.votes } });
  }

  queryVotesByCorporateId(corporateId: string): Promise<ElectionVoteEntity[]> {
    const query = new VoteQuery<ParameterCorporateId>(Query.VotesByCorporateId, { corporateId });
    return query.discover(this, this._entities, thisProviderType);
  }
}
