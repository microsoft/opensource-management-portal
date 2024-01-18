//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import {
  ICacheOptions,
  ICacheOptionsWithPurpose,
  GetAuthorizationHeader,
  IOperationsInstance,
  PurposefulGetAuthorizationHeader,
  PagedCacheOptionsWithPurpose,
  throwIfNotGitHubCapable,
} from '../interfaces';
import { HttpMethod } from '../lib/github';
import { CreateError } from '../lib/transitional';
import { AppPurpose, AppPurposeTypes } from '../lib/github/appPurposes';
import {
  CacheDefault,
  createPagedCacheOptions,
  getMaxAgeSeconds,
  getPageSize,
  popPurpose,
  symbolizeApiResponse,
} from './operations/core';
import { Organization } from './organization';

export enum CustomPropertyValueType {
  String = 'string',
  SingleSelect = 'single_select',
}

export type OrganizationCustomPropertyEntity = {
  property_name: string;
  value_type: CustomPropertyValueType;
  required: boolean;
  description?: string;
  default_value?: string;
  allowed_values?: string[];
};

export type OrganizationCustomPropertySetPropertyValue = {
  property_name: string;
  value: string;
};

type CreateOrUpdateResponse = {
  properties: OrganizationCustomPropertyEntity[];
};

export class OrganizationProperties {
  private _defaultPurpose = AppPurpose.Data;

  constructor(
    private organization: Organization,
    private getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader,
    private operations: IOperationsInstance
  ) {}

  private authorize(purpose: AppPurposeTypes): GetAuthorizationHeader | string {
    const getAuthorizationHeader = this.getSpecificAuthorizationHeader.bind(
      this,
      purpose
    ) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }

  async getCustomProperties(
    options?: PagedCacheOptionsWithPurpose
  ): Promise<OrganizationCustomPropertyEntity[]> {
    options = options || {};
    const operations = throwIfNotGitHubCapable(this.operations);
    const { github } = operations;
    const purpose = popPurpose(options, this._defaultPurpose);
    const parameters = {
      org: this.organization.name,
      per_page: getPageSize(operations),
    };
    const cacheOptions = createPagedCacheOptions(operations, options);
    try {
      const entities = await github.collections.collectAllPagesViaHttpGet<
        any,
        OrganizationCustomPropertyEntity
      >(
        this.authorize(purpose),
        'orgCustomProps',
        'GET /orgs/:org/properties/schema',
        parameters,
        cacheOptions
      );
      return symbolizeApiResponse(entities);
    } catch (error) {
      throw error;
    }
  }

  async getCustomProperty(
    propertyName: string,
    options?: ICacheOptionsWithPurpose
  ): Promise<OrganizationCustomPropertyEntity> {
    options = options || {};
    const operations = throwIfNotGitHubCapable(this.operations);
    const { github } = operations;
    if (!propertyName) {
      throw CreateError.InvalidParameters('propertyName');
    }
    const purpose = popPurpose(options, this._defaultPurpose);
    const parameters = {
      org: this.organization.name,
      custom_property_name: propertyName,
    };
    const cacheOptions: ICacheOptions = {
      maxAgeSeconds: getMaxAgeSeconds(operations, CacheDefault.accountDetailStaleSeconds, options, 60),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    try {
      const entity = (await github.request(
        this.authorize(purpose),
        'GET /orgs/:org/properties/schema/:custom_property_name',
        parameters,
        cacheOptions
      )) as OrganizationCustomPropertyEntity;
      return symbolizeApiResponse(entity);
    } catch (error) {
      throw error;
    }
  }

  async deleteProperty(propertyName: string, purpose?: AppPurposeTypes): Promise<void> {
    const operations = throwIfNotGitHubCapable(this.operations);
    const parameters = {
      org: this.organization.name,
      custom_property_name: propertyName,
    };
    await operations.github.restApi(
      this.authorize(purpose || this._defaultPurpose),
      HttpMethod.Delete,
      '/orgs/:org/properties/schema/:custom_property_name',
      parameters
    );
  }

  async createOrUpdate(
    properties: OrganizationCustomPropertyEntity[],
    purpose?: AppPurposeTypes
  ): Promise<OrganizationCustomPropertyEntity[]> {
    const operations = throwIfNotGitHubCapable(this.operations);
    const parameters = {
      org: this.organization.name,
      properties,
    };
    const res = (await operations.github.restApi(
      this.authorize(purpose || this._defaultPurpose),
      HttpMethod.Patch,
      '/orgs/:org/properties/schema',
      parameters
    )) as CreateOrUpdateResponse;
    return res.properties;
  }

  async createOrUpdateRepositoriesProperties(
    organizationRepositoryNames: string[],
    propertiesAndValues: Record<string, string>,
    purpose?: AppPurposeTypes
  ): Promise<void> {
    const operations = throwIfNotGitHubCapable(this.operations);
    if (organizationRepositoryNames.length > 30) {
      throw CreateError.InvalidParameters(
        'GitHub has a hard limit of 30 repositories to update in a single patch'
      );
    }
    const parameters = {
      org: this.organization.name,
      properties: setPropertiesRecordToArray(propertiesAndValues),
      repository_names: organizationRepositoryNames,
    };
    (await operations.github.restApi(
      this.authorize(purpose || this._defaultPurpose),
      HttpMethod.Patch,
      '/orgs/:org/properties/values',
      parameters
    )) as CreateOrUpdateResponse;
  }
}

function setPropertiesRecordToArray(propertiesAndValues: Record<string, string>) {
  const keys = Object.getOwnPropertyNames(propertiesAndValues);
  const properties: OrganizationCustomPropertySetPropertyValue[] = [];
  for (const key of keys) {
    properties.push({
      property_name: key,
      value: propertiesAndValues[key],
    });
  }
  return properties;
}
