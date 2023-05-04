//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Organization annotations are a way to store arbitrary data about an
// organization without us having to manage that organization in this
// environment.

async function initialize(
  options?: IOrganizationAnnotationProviderCreateOptions
): Promise<IOrganizationAnnotationMetadataProvider> {
  const provider = new OrganizationAnnotationMetadataProvider(options);
  await provider.initialize();
  return provider;
}

export default initialize;

import {
  IEntityMetadata,
  EntityMetadataType,
  IEntityMetadataBaseOptions,
  EntityMetadataBase,
} from '../lib/entityMetadataProvider/entityMetadata';
import { IEntityMetadataFixedQuery, QueryBase } from '../lib/entityMetadataProvider/query';
import {
  EntityMetadataMappings,
  MetadataMappingDefinition,
} from '../lib/entityMetadataProvider/declarations';
import { PostgresSettings, PostgresConfiguration } from '../lib/entityMetadataProvider/postgres';
import { IDictionary } from '../interfaces';
import { CreateError, ErrorHelper } from '../transitional';
import { MemoryConfiguration, TableConfiguration } from '../lib/entityMetadataProvider';

const type = new EntityMetadataType('OrganizationAnnotation');
const thisProviderType = type;
type ClassType = OrganizationAnnotation;

const defaultPostgresTableName = 'organizationannotations';
const organizationId = 'organizationId';
const primaryKeyFieldName = organizationId;

export enum OrganizationAnnotationProperty {}
export enum OrganizationAnnotationFeature {}

export interface IOrganizationAnnotationChange {
  date?: string | Date;
  corporateId?: string;
  displayName?: string;
  details?: string;
  text: string;
}

interface IOrganizationAnnotationMetadataProperties {
  // organizationId: string; // primary ID

  created: any;
  updated: any;

  properties: any;
  features: any;

  administratorNotes: any;
  notes: any;

  directOwnersSecurityGroupId: any;
  directOwnersIds: any;

  history: any;

  additionalData: any;
}

class OrganizationAnnotationQueryBase extends QueryBase<OrganizationAnnotation> {
  constructor(public query: Query) {
    super();
  }
}

// class OrganizationAnnotationQuery<T> extends OrganizationAnnotationQueryBase {
//   constructor(query: Query, public parameters: T) {
//     super(query);
//     if (!this.parameters) {
//       this.parameters = {} as T;
//     }
//   }
// }

enum Query {
  All,
}

class QueryByAll extends OrganizationAnnotationQueryBase {
  constructor() {
    super(Query.All);
  }
}

const Field: IOrganizationAnnotationMetadataProperties = {
  // organizationId: 'organizationId'
  created: 'created',
  updated: 'updated',
  properties: 'properties',
  features: 'features',
  administratorNotes: 'administratorNotes',
  notes: 'notes',
  directOwnersSecurityGroupId: 'directOwnersSecurityGroupId',
  directOwnersIds: 'directOwnersIds',
  history: 'history',
  additionalData: 'additionalData',
};

const fieldNames = Object.getOwnPropertyNames(Field);
const nativeFieldNames = []; // fieldNames.filter((x) => x !== Field.additionalData);

export class OrganizationAnnotation implements IOrganizationAnnotationMetadataProperties {
  organizationId: string;

  created: Date;
  updated: Date;

  properties: Record<string | OrganizationAnnotationProperty, string>;
  features: (string | OrganizationAnnotationFeature)[];

  administratorNotes: string;
  notes: string;

  directOwnersSecurityGroupId: string;
  directOwnersIds: string[];

  history: IOrganizationAnnotationChange[];

  additionalData: IDictionary<any>;

  constructor() {
    this.history = [];
    this.features = [];
    this.properties = {};
  }

  hasFeature(feature: string | OrganizationAnnotationFeature): boolean {
    return this.features.includes(feature);
  }

  getProperty(key: string | OrganizationAnnotationProperty): string | boolean | number {
    return this.properties[key];
  }
}

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => {
  return new OrganizationAnnotation();
});
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, organizationId);

const defaultTableName = defaultPostgresTableName;

TableConfiguration.SetDefaultTableName(type, defaultTableName);
TableConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
TableConfiguration.SetFixedPartitionKey(type, defaultTableName);

MemoryConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);

EntityMetadataMappings.Register(
  type,
  PostgresSettings.PostgresDefaultTypeColumnName,
  defaultPostgresTableName
);
PostgresConfiguration.SetDefaultTableName(type, defaultPostgresTableName);
EntityMetadataMappings.Register(type, PostgresSettings.PostgresDateColumns, [Field.created, Field.updated]);
PostgresConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
PostgresConfiguration.IdentifyNativeFields(type, nativeFieldNames);
PostgresConfiguration.ValidateMappings(type, fieldNames, [primaryKeyFieldName]);

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
    const base = query as OrganizationAnnotationQueryBase;
    switch (base.query) {
      case Query.All: {
        return {
          sql: `
          SELECT *
          FROM
            ${tableName}
        `,
          values: [],
        };
      }
      default:
        throw new Error(`The query ${base.query} is not implemented by this provider for the type ${type}`);
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

export interface IOrganizationAnnotationProviderCreateOptions extends IEntityMetadataBaseOptions {}

export interface IOrganizationAnnotationMetadataProvider {
  initialize(): Promise<void>;
  getOrCreateAnnotations(organizationId: string): Promise<ClassType>;
  getAnnotations(organizationId: string): Promise<ClassType>;
  insertAnnotations(annotations: ClassType): Promise<string>;
  deleteAnnotations(annotations: ClassType): Promise<void>;
  replaceAnnotations(annotations: ClassType): Promise<void>;
  getAllAnnotations(): Promise<ClassType[]>;
}

export class OrganizationAnnotationMetadataProvider
  extends EntityMetadataBase
  implements IOrganizationAnnotationMetadataProvider
{
  constructor(options: IOrganizationAnnotationProviderCreateOptions) {
    super(thisProviderType, options);
    EntityImplementation.EnsureDefinitions();
  }

  async getOrCreateAnnotations(organizationId: string) {
    try {
      const annotations = await this.getAnnotations(organizationId);
      if (annotations) {
        return annotations;
      }
      throw CreateError.NotFound('No metadata');
    } catch (error) {
      if (ErrorHelper.IsNotFound(error)) {
        const emptyMetadata = new OrganizationAnnotation();
        emptyMetadata.organizationId = organizationId;
        await this.insertAnnotations(emptyMetadata);
        return emptyMetadata;
      }
      throw error;
    }
  }

  async deleteAnnotations(annotations: ClassType): Promise<void> {
    const entity = this.serialize(thisProviderType, annotations);
    this._entities.deleteMetadata(entity);
    await this._entities.updateMetadata(entity);
  }

  async getAnnotations(organizationId: string): Promise<ClassType> {
    this.ensureHelpers(thisProviderType);
    let metadata: IEntityMetadata = null;
    metadata = await this._entities.getMetadata(thisProviderType, organizationId);
    return this.deserialize<ClassType>(thisProviderType, metadata);
  }

  async insertAnnotations(annotations: ClassType): Promise<string> {
    const entity = this.serialize(thisProviderType, annotations);
    await this._entities.setMetadata(entity);
    return entity.entityId;
  }

  async replaceAnnotations(annotations: ClassType): Promise<void> {
    const entity = this.serialize(thisProviderType, annotations);
    await this._entities.updateMetadata(entity);
  }

  async getAllAnnotations() {
    const query = new QueryByAll();
    const data = await this._entities.fixedQueryMetadata(type, query);
    return this.deserializeArray<ClassType>(thisProviderType, data);
  }
}

export const EntityImplementation = {
  Type: type,
  EnsureDefinitions: () => {},
};
