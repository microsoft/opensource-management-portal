//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from './repository.js';
import { AppPurpose, AppPurposeTypes } from '../lib/github/appPurposes.js';
import { createCacheOptions, Operations, popPurpose, symbolizeApiResponse } from './index.js';
import {
  PurposefulGetAuthorizationHeader,
  GetAuthorizationHeader,
  ICacheOptionsWithPurpose,
} from '../interfaces/index.js';
import { OrganizationCustomPropertySetPropertyValue } from './organizationProperties.js';

export class RepositoryProperties {
  private _defaultPurpose = AppPurpose.Data;
  private _getAuthorizationHeader: PurposefulGetAuthorizationHeader;

  constructor(
    private readonly repository: Repository,
    private operations: Operations,
    getAuthorizationHeader: PurposefulGetAuthorizationHeader
  ) {
    this._getAuthorizationHeader = getAuthorizationHeader;
  }

  async createOrUpdateProperties(
    propertiesAndValues: Record<string, string>,
    purpose?: AppPurposeTypes
  ): Promise<void> {
    const operations = this.operations as Operations;
    const { github } = operations;
    const { rest } = operations.github.octokit;
    const requirements = operations.github.createRequirementsForFunction(
      this.authorize(purpose || AppPurpose.Data),
      rest.repos.createOrUpdateCustomPropertiesValues,
      'repos.createOrUpdateCustomPropertiesValues',
      {
        permissions: {
          permission: 'repository_custom_properties',
          access: 'write',
        },
        permissionsMatchRequired: true,
      }
    );
    const parameters = {
      owner: this.repository.organization.name,
      repo: this.repository.name,
      properties: this.setPropertiesRecordToArray(propertiesAndValues),
    };
    await github.postWithRequirements(
      requirements,
      parameters as unknown as Record<string, string | number | boolean>
    );
  }

  setPropertiesRecordToArray(propertiesAndValues: Record<string, string>) {
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

  async getProperties(options?: ICacheOptionsWithPurpose): Promise<Record<string, string>> {
    options = options || {};
    const operations = this.operations as Operations;
    const { github } = operations;
    const purpose = popPurpose(options, this._defaultPurpose);
    const parameters = {
      owner: this.repository.organization.name,
      repo: this.repository.name,
    };
    const cacheOptions = createCacheOptions(operations, options);
    try {
      const { rest } = github.octokit;
      const responseArray = await github.callWithRequirements(
        github.createRequirementsForFunction(
          this.authorize(purpose || AppPurpose.Data),
          rest.repos.getCustomPropertiesValues,
          'repos.getCustomPropertiesValues',
          {
            permissions: {
              access: 'read',
              permission: 'metadata',
            },
          }
        ),
        parameters,
        cacheOptions
      );
      return symbolizeApiResponse(arrayToSetProperties(responseArray));
    } catch (error) {
      throw error;
    }
  }

  private authorize(purpose: AppPurposeTypes): GetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(this, purpose) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}

function arrayToSetProperties(properties: OrganizationCustomPropertySetPropertyValue[]) {
  const propertiesAndValues: Record<string, string> = {};
  for (const property of properties) {
    propertiesAndValues[property.property_name] = property.value;
  }
  return propertiesAndValues;
}
