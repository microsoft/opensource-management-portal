//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { EntityField} from '../../lib/entityMetadataProvider/entityMetadataProvider';
import { IEntityMetadata, EntityMetadataType, IEntityMetadataBaseOptions, EntityMetadataBase } from '../../lib/entityMetadataProvider/entityMetadata';
import { IEntityMetadataFixedQuery, FixedQueryType } from '../../lib/entityMetadataProvider/query';
import { EntityMetadataMappings, MetadataMappingDefinition } from '../../lib/entityMetadataProvider/declarations';
import { PostgresJsonEntityQuery } from '../../lib/entityMetadataProvider/postgres';
import { IDictionary } from '../../transitional';
import { v4 } from 'uuid';
import { stringOrNumberAsString } from '../../utils';

const type = new EntityMetadataType('ElectionNominationComment');

const postgresTableName = 'voting';

interface IElectionNominationCommentProperties {
  // THIS IS THE PRIMARY ID: commentId: any;
  nominationId: any;
  corporateId: any;
  corporateDisplayName: any;
  created: any;
  comment: any;
}

const commentId = 'commentId';

const Field: IElectionNominationCommentProperties = {
  // commentId: 'commentId',
  nominationId: 'nominationId',
  corporateId: 'corporateId',
  corporateDisplayName: 'corporateDisplayName',
  created: 'created',
  comment: 'comment',
}

const fieldNames = Object.getOwnPropertyNames(Field);

export class ElectionNominationCommentEntity implements IElectionNominationCommentProperties {
  commentId: string;

  nominationId: string;
  corporateId: string;
  corporateDisplayName: string;
  created: Date;
  comment: string;

  constructor() {
    this.commentId = v4();
  }
}

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => { return new ElectionNominationCommentEntity(); });
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, commentId);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresDefaultTableName, postgresTableName);
EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresDefaultTypeColumnName, commentId.toLowerCase());
EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresMapping, new Map<string, string>([
  [Field.nominationId, (Field.nominationId).toLowerCase()],
  [Field.corporateId, (Field.corporateId).toLowerCase()],
  [Field.corporateDisplayName, (Field.corporateDisplayName).toLowerCase()],
  [Field.created, (Field.created).toLowerCase()],
  [Field.comment, (Field.comment).toLowerCase()],
]));
EntityMetadataMappings.RuntimeValidateMappings(type, MetadataMappingDefinition.PostgresMapping, fieldNames, [commentId]);

EntityMetadataMappings.Register(type, MetadataMappingDefinition.PostgresQueries, (query: IEntityMetadataFixedQuery, mapMetadataPropertiesToFields: string[], metadataColumnName: string, tableName: string, getEntityTypeColumnValue) => {
  const entityTypeColumn = mapMetadataPropertiesToFields[EntityField.Type];
  const entityTypeValue = getEntityTypeColumnValue(type);
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

const EntityImplementation = {
  Type: type,
  EnsureDefinitions: () => {},
};

const thisProviderType = EntityImplementation.Type;

export interface IElectionNominationCommentEntityProvider {
  insertComment(commentEntity: ElectionNominationCommentEntity): Promise<string>;
}

export class ElectionNominationCommentEntityProvider extends EntityMetadataBase implements IElectionNominationCommentEntityProvider {
  constructor(options: IEntityMetadataBaseOptions) {
    super(options);
    EntityImplementation.EnsureDefinitions();
  }

  async insertComment(record: ElectionNominationCommentEntity): Promise<string> {
    const entity = this.serialize(thisProviderType, record);
    await this._entities.setMetadata(entity);
    return entity.entityId;
  }
}
