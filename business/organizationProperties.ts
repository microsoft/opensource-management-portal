//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import {
  ICacheOptions,
  ICacheOptionsWithPurpose,
  GetAuthorizationHeader,
  PurposefulGetAuthorizationHeader,
  PagedCacheOptionsWithPurpose,
} from '../interfaces/index.js';
import { HttpMethod } from '../lib/github/index.js';
import { CreateError } from '../lib/transitional.js';
import { AppPurpose, AppPurposeTypes } from '../lib/github/appPurposes.js';
import {
  CacheDefault,
  createPagedCacheOptions,
  getMaxAgeSeconds,
  getPageSize,
  Operations,
  popPurpose,
  symbolizeApiResponse,
} from './operations/core.js';
import { Organization } from './organization.js';

export enum CustomPropertyValueType {
  String = 'string',
  SingleSelect = 'single_select',
  MultiSelect = 'multi_select',
  TrueFalse = 'true_false',
}

export type OrganizationCustomPropertyEntity = {
  property_name: string;
  value_type: CustomPropertyValueType;
  required: boolean;
  description?: string;
  default_value?: string;
  allowed_values?: string[];
  values_editable_by?: string;
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
    private operations: Operations
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
    const operations = this.operations as Operations;
    const { github } = operations;
    const purpose = popPurpose(options, this._defaultPurpose);
    const parameters = {
      org: this.organization.name,
      per_page: getPageSize(operations),
    };
    const cacheOptions = createPagedCacheOptions(operations as Operations, options);
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
    const operations = this.operations as Operations;
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
      maxAgeSeconds: getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.accountDetailStaleSeconds,
        options,
        60
      ),
    };
    if (options.backgroundRefresh !== undefined) {
      cacheOptions.backgroundRefresh = options.backgroundRefresh;
    }
    const { rest } = github.octokit;
    try {
      const entity = (await github.callWithRequirements(
        github.createRequirementsForFunction(
          this.authorize(purpose),
          rest.orgs.getCustomProperty,
          'orgs.getCustomProperty'
        ),
        parameters,
        cacheOptions
      )) as OrganizationCustomPropertyEntity;
      return symbolizeApiResponse(entity);
    } catch (error) {
      throw error;
    }
  }

  async deleteProperty(propertyName: string, purpose?: AppPurposeTypes): Promise<void> {
    const operations = this.operations as Operations;
    const parameters = {
      org: this.organization.name,
      custom_property_name: propertyName,
    };
    const { github } = operations;
    await github.postWithRequirements(
      github.createRequirementsForRequest(
        this.authorize(purpose || this._defaultPurpose),
        `${HttpMethod.Delete} /orgs/:org/properties/schema/:custom_property_name`
      ),
      parameters
    );
  }

  async createOrUpdate(
    properties: OrganizationCustomPropertyEntity[],
    purpose?: AppPurposeTypes
  ): Promise<OrganizationCustomPropertyEntity[]> {
    const operations = this.operations as Operations;
    const parameters = {
      org: this.organization.name,
      properties,
    };
    const { github } = operations;
    try {
      const result = await github.requestWithRequirements(
        github.createRequirementsForRequest(
          this.authorize(purpose || this._defaultPurpose),
          `${HttpMethod.Patch} /orgs/:org/properties/schema`,
          {
            permissions: {
              permission: 'custom properties',
              access: 'write',
            },
          }
        ),
        parameters as any
      );
      return symbolizeApiResponse(result);
    } catch (error) {
      throw error;
    }
  }

  async createOrUpdateRepositoriesProperties(
    organizationRepositoryNames: string[],
    propertiesAndValues: Record<string, string>,
    purpose?: AppPurposeTypes
  ): Promise<void> {
    const operations = this.operations as Operations;
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
    const { github } = operations;
    try {
      const result = await github.requestAsPostWithRequirements(
        github.createRequirementsForRequest(
          this.authorize(purpose || this._defaultPurpose),
          `${HttpMethod.Patch} /orgs/:org/properties/values`,
          {
            permissions: {
              permission: 'custom properties',
              access: 'write',
            },
          }
        ),
        parameters as any
      );
      return symbolizeApiResponse(result);
    } catch (error) {
      throw error;
    }
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
