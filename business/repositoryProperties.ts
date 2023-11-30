//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from './repository';
import { AppPurpose, AppPurposeTypes } from '../lib/github/appPurposes';
import { createCacheOptions, popPurpose, symbolizeApiResponse } from '.';
import {
  IOperationsInstance,
  PurposefulGetAuthorizationHeader,
  throwIfNotGitHubCapable,
  GetAuthorizationHeader,
  ICacheOptionsWithPurpose,
} from '../interfaces';
import { OrganizationCustomPropertySetPropertyValue } from './organizationProperties';

export class RepositoryProperties {
  private _defaultPurpose = AppPurpose.Data;
  private _getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader;

  constructor(
    public readonly repository: Repository,
    private operations: IOperationsInstance,
    getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader
  ) {
    this._getSpecificAuthorizationHeader = getSpecificAuthorizationHeader;
  }

  createOrUpdateProperties(
    propertiesAndValues: Record<string, string>,
    purpose?: AppPurposeTypes
  ): Promise<void> {
    const names = [this.repository.name];
    const organizationProperties = this.repository.organization.customProperties;
    return organizationProperties.createOrUpdateRepositoriesProperties(names, propertiesAndValues, purpose);
  }

  async getProperties(options?: ICacheOptionsWithPurpose): Promise<Record<string, string>> {
    options = options || {};
    const operations = throwIfNotGitHubCapable(this.operations);
    const { github } = operations;
    const purpose = popPurpose(options, this._defaultPurpose);
    const parameters = {
      owner: this.repository.organization.name,
      repo: this.repository.name,
    };
    const cacheOptions = createCacheOptions(operations, options);
    try {
      const responseArray = await github.request(
        this.authorize(purpose),
        'GET /repos/:owner/:repo/properties/values',
        parameters,
        cacheOptions
      );
      return symbolizeApiResponse(arrayToSetProperties(responseArray));
    } catch (error) {
      throw error;
    }
  }

  private authorize(purpose: AppPurposeTypes): GetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getSpecificAuthorizationHeader.bind(
      this,
      purpose
    ) as GetAuthorizationHeader;
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
