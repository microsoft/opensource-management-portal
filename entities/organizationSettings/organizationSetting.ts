//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { EntityField } from '../../lib/entityMetadataProvider/entityMetadataProvider';
import { IEntityMetadata } from '../../lib/entityMetadataProvider/entityMetadata';
import { IEntityMetadataFixedQuery, FixedQueryType } from '../../lib/entityMetadataProvider/query';
import {
  EntityMetadataMappings,
  MetadataMappingDefinition,
} from '../../lib/entityMetadataProvider/declarations';
import { Type } from './type';
import { PostgresGetAllEntities } from '../../lib/entityMetadataProvider/postgres';
import {
  MemoryConfiguration,
  MemorySettings,
  PostgresSettings,
  PostgresConfiguration,
  TableConfiguration,
  TableSettings,
} from '../../lib/entityMetadataProvider';
import { ConfigGitHubOrganization } from '../../config/github.organizations.types';
import { odata, TableEntityQueryOptions } from '@azure/data-tables';

export interface IBasicGitHubAppInstallation {
  appId: number;
  installationId: number;
  appPurposeId?: string;
}

export enum SpecialTeam {
  Everyone = 'everyone', // teamAllMembers
  Sudo = 'sudo', // teamSudoers
  GlobalSudo = 'globalSudo', // teamPortalSudoers
  SystemWrite = 'systemWrite', // teamAllReposWrite
  SystemRead = 'systemRead', // teamAllReposRead
  SystemAdmin = 'systemAdmin', // teamAllReposAdmin
}

export enum OrganizationFeature {
  Invisible = 'invisible',
  LockedMembership = 'locked',
  Hidden = 'hidden',
  Ignore = 'ignore',
  CreateNativeRepositories = 'createReposDirect',
  LockTransfers = 'lock-transfers',
  LockNewForks = 'lock-new-forks',
  DeleteNewForks = 'delete-new-forks',
  ApplicationHostOrganizationOnly = 'appOnly',
  PreventLargeTeamPermissionGrants = 'preventLargeTeamPermissions',
}

export enum OrganizationProperty {
  Priority = 'priority',
}

export interface ISpecialTeam {
  specialTeam: SpecialTeam;
  teamId: number;
}

const type = Type;

const tableName = 'organizationsettings';

interface IOrganizationSettingProperties {
  // THIS IS THE PRIMARY ID: organizationId: any;
  organizationName: any;

  setupByCorporateDisplayName: any;
  setupByCorporateId: any;
  setupByCorporateUsername: any;
  setupDate: any;

  active: any;
  updated: any;
  portalDescription: any;
  operationsNotes: any;

  installations: any; // app: id

  features: any; // flags
  properties: any; // objects with a setting name
  specialTeams: any; // key: teamid
  templates: any; // string list
  legalEntities: any; // string list
}

const organizationId = 'organizationId';
const primaryKeyFieldName = organizationId;

const Field: IOrganizationSettingProperties = {
  // organizationId: 'organizationId',
  setupByCorporateDisplayName: 'setupByCorporateDisplayName',
  setupByCorporateId: 'setupByCorporateId',
  setupByCorporateUsername: 'setupByCorporateUsername',
  setupDate: 'setupDate',
  active: 'active',
  updated: 'updated',
  organizationName: 'organizationName',
  portalDescription: 'portalDescription',
  operationsNotes: 'operationsNotes',
  installations: 'installations',
  features: 'features',
  properties: 'properties',
  specialTeams: 'specialTeams',
  templates: 'templates',
  legalEntities: 'legalEntities',
};

const fieldNames = Object.getOwnPropertyNames(Field);

export class OrganizationSetting implements IOrganizationSettingProperties {
  #ownerToken: string;

  organizationId: number;
  organizationName: string;

  active: boolean;

  setupDate: Date;
  updated: Date;

  setupByCorporateDisplayName: string;
  setupByCorporateId: string;
  setupByCorporateUsername: string;

  portalDescription: string;
  operationsNotes: string;

  installations: IBasicGitHubAppInstallation[];
  features: string[];
  properties: Record<string | OrganizationProperty, string>;

  specialTeams: ISpecialTeam[];
  templates: string[];
  legalEntities: string[];

  constructor() {
    this.installations = [];
    this.features = [];
    this.properties = {};
    this.specialTeams = [];
    this.templates = [];
    this.legalEntities = [];
  }

  hasFeature(feature: string | OrganizationFeature): boolean {
    return this.features.includes(feature);
  }

  getProperty(key: string | OrganizationProperty): string | boolean | number {
    return this.properties[key];
  }

  getOwnerToken() {
    return this.#ownerToken;
  }

  static CreateFromStaticSettings(staticSettings: ConfigGitHubOrganization): OrganizationSetting {
    const clone = { ...staticSettings };
    const settings = new OrganizationSetting();
    if (clone.ownerToken) {
      settings.#ownerToken = clone.ownerToken;
      delete clone.ownerToken;
    }

    settings.organizationId = clone.id;
    settings.organizationName = clone.name;
    delete clone.id;
    delete clone.name;

    settings.portalDescription = clone.description || '';
    delete clone.description;

    settings.templates =
      clone.templates && Array.isArray(clone.templates) ? (clone.templates as string[]) : [];
    delete clone.templates;

    // Feature flags
    if (clone.active !== undefined) {
      settings.active = clone.active;
    }
    delete clone.active;

    if (clone.startupDiscover) {
      settings.features.push('startupDiscover');
    }
    delete clone.startupDiscover;

    if (clone.preventLargeTeamPermissions === true) {
      settings.features.push('preventLargeTeamPermissions');
    }
    delete clone.preventLargeTeamPermissions;

    if (clone.hidden === true) {
      settings.features.push('hidden');
    }
    delete clone.hidden;

    if (clone.locked === true) {
      settings.features.push('locked');
    }
    delete clone.locked;

    if (clone.ignore === true) {
      settings.features.push('ignore');
      // should make sure you cannot enable/active:true on an ignored org
    }
    delete clone.ignore;

    if (clone.createReposDirect === true) {
      settings.features.push('createReposDirect');
    }
    delete clone.createReposDirect;

    if (clone.externalMembersPermitted === true) {
      settings.features.push('externalMembersPermitted');
    }
    delete clone.externalMembersPermitted;

    if (clone.privateEngineering === true) {
      settings.features.push('privateEngineering');
    }
    delete clone.privateEngineering;

    if (clone.noPrivateEngineeringNags === true) {
      settings.features.push('noPrivateEngineeringNags');
    }
    delete clone.noPrivateEngineeringNags;

    // Properties

    if (clone['hookSecrets']) {
      settings.properties['hookSecretsNotTransferred'] = 'hook shared secrets were not migrated';
    }
    delete clone['hookSecrets'];

    if (clone['type']) {
      settings.properties['type'] = clone['type'];
    }
    delete clone['type'];

    if (clone['1es']) {
      settings.properties['1es'] = clone['1es'];
    }
    delete clone['1es'];

    if (clone['priority']) {
      settings.properties['priority'] = clone['priority'];
    }
    delete clone['priority'];

    // Special teams

    if (clone.teamAllMembers) {
      const arr = Array.isArray(clone.teamAllMembers)
        ? (clone.teamAllMembers as any[])
        : [clone.teamAllMembers as any];
      for (const value of arr) {
        settings.specialTeams.push({
          specialTeam: SpecialTeam.Everyone,
          teamId: Number(value),
        });
      }
    }
    delete clone.teamAllMembers;

    if (clone.teamAllReposRead) {
      const arr = Array.isArray(clone.teamAllReposRead)
        ? (clone.teamAllReposRead as any[])
        : [clone.teamAllReposRead as any];
      for (const value of arr) {
        settings.specialTeams.push({
          specialTeam: SpecialTeam.SystemRead,
          teamId: Number(value),
        });
      }
    }
    delete clone.teamAllReposRead;

    if (clone.teamAllReposWrite) {
      const arr = Array.isArray(clone.teamAllReposWrite)
        ? (clone.teamAllReposWrite as any[])
        : [clone.teamAllReposWrite as any];
      for (const value of arr) {
        settings.specialTeams.push({
          specialTeam: SpecialTeam.SystemWrite,
          teamId: Number(value),
        });
      }
    }
    delete clone.teamAllReposWrite;

    if (clone.teamAllReposAdmin) {
      const arr = Array.isArray(clone.teamAllReposAdmin)
        ? (clone.teamAllReposAdmin as any[])
        : [clone.teamAllReposAdmin as any];
      for (const value of arr) {
        settings.specialTeams.push({
          specialTeam: SpecialTeam.SystemAdmin,
          teamId: Number(value),
        });
      }
    }
    delete clone.teamAllReposAdmin;

    if (clone.teamSudoers) {
      const arr = Array.isArray(clone.teamSudoers)
        ? (clone.teamSudoers as any[])
        : [clone.teamSudoers as any];
      for (const value of arr) {
        settings.specialTeams.push({
          specialTeam: SpecialTeam.Sudo,
          teamId: Number(value),
        });
      }
    }
    delete clone.teamSudoers;

    if (clone.teamPortalSudoers) {
      const arr = Array.isArray(clone.teamPortalSudoers)
        ? (clone.teamPortalSudoers as any[])
        : [clone.teamPortalSudoers as any];
      for (const value of arr) {
        settings.specialTeams.push({
          specialTeam: SpecialTeam.GlobalSudo,
          teamId: Number(value),
        });
      }
    }
    delete clone.teamPortalSudoers;

    // Legal entities

    if (clone.legalEntities) {
      for (const entity of clone.legalEntities) {
        settings.legalEntities.push(entity);
      }
    }
    delete clone.legalEntities;

    // for annotating settings traditionally
    delete clone.__special__note__;
    delete clone.__special_note___;

    const remainingKeys = Object.getOwnPropertyNames(clone);
    if (remainingKeys.length) {
      const message = `There are static keys which are not recognized by the settings migration system. Please have the system updated before trying to adopt or import this organization. Keys remaining from the static configuration: ${remainingKeys.join(
        ', '
      )}`;
      throw new Error(message);
    }
    return settings;
  }
}

export class OrganizationSettingFixedQueryAll implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.OrganizationSettingsGetAll;
}

export class OrganizationSettingFixedQueryMostRecentlyUpdatedActive implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType =
    FixedQueryType.OrganizationSettingsGetMostRecentlyUpdatedActive;
}

EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityInstantiate, () => {
  return new OrganizationSetting();
});
EntityMetadataMappings.Register(type, MetadataMappingDefinition.EntityIdColumnName, organizationId);

MemoryConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
EntityMetadataMappings.RuntimeValidateMappings(type, MemorySettings.MemoryMapping, fieldNames, [
  organizationId,
]);

PostgresConfiguration.SetDefaultTableName(type, tableName);
EntityMetadataMappings.Register(type, PostgresSettings.PostgresDefaultTypeColumnName, 'organizationsetting');
EntityMetadataMappings.Register(type, PostgresSettings.PostgresDateColumns, ['updated', 'setupDate']);
PostgresConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
PostgresConfiguration.ValidateMappings(type, fieldNames, [organizationId]);

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
    // const entityIDColumn = mapMetadataPropertiesToFields[EntityField.ID];
    const entityTypeValue = getEntityTypeColumnValue(type);
    switch (query.fixedQueryType) {
      case FixedQueryType.OrganizationSettingsGetAll: {
        return PostgresGetAllEntities(tableName, entityTypeColumn, entityTypeValue);
      }
      //  case FixedQueryType.OrganizationSettingsGetMostRecentlyUpdatedActive: {
      default:
        throw new Error(
          `The fixed query type "${query.fixedQueryType}" is not implemented by this provider for the type ${type}`
        );
    }
  }
);

EntityMetadataMappings.Register(
  type,
  MemorySettings.MemoryQueries,
  (query: IEntityMetadataFixedQuery, allInTypeBin: IEntityMetadata[]) => {
    switch (query.fixedQueryType) {
      case FixedQueryType.OrganizationSettingsGetAll:
        return allInTypeBin;
      default:
        throw new Error(
          `The fixed query type "${query.fixedQueryType}" is not implemented by this provider for the type ${type}`
        );
    }
  }
);

TableConfiguration.SetDefaultTableName(type, tableName);
TableConfiguration.SetDateColumns(type, [Field.updated]);
TableConfiguration.MapFieldsToColumnNamesFromListLowercased(type, fieldNames);
TableConfiguration.SetNoPrefixForPartitionKey(type);
TableConfiguration.SetFixedPartitionKey(type, tableName);
EntityMetadataMappings.RuntimeValidateMappings(type, TableSettings.TableMapping, fieldNames, [
  primaryKeyFieldName,
]);

EntityMetadataMappings.Register(
  type,
  TableSettings.TableQueries,
  (query: IEntityMetadataFixedQuery, fixedPartitionKey: string) => {
    switch (query.fixedQueryType) {
      case FixedQueryType.OrganizationSettingsGetAll: {
        return {
          filter: odata`PartitionKey eq ${fixedPartitionKey}`,
        } as TableEntityQueryOptions;
      }
      default: {
        throw new Error(
          `The fixed query type ${query.fixedQueryType} is not supported currently by this ${type} provider`
        );
      }
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
