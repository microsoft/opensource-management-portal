//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { CacheDefault, getMaxAgeSeconds, Operations, symbolizeApiResponse } from './operations/core.js';
import { HttpMethod } from '../lib/github/index.js';
import { NoCacheNoBackground } from '../interfaces/github/rest.js';

import type { ICacheOptions } from '../interfaces/github/rest.js';
import type GitHubEnterprise from './enterprise.js';
import type { IProviders } from '../interfaces/providers.js';

// Premium request usage types

export type PremiumRequestTimePeriod = {
  year: number;
  month?: number;
  day?: number;
};

export type PremiumRequestUsageItem = {
  product: string;
  sku: string;
  model: string;
  unitType: string;
  pricePerUnit: number;
  grossQuantity: number;
  grossAmount: number;
  discountQuantity: number;
  discountAmount: number;
  netQuantity: number;
  netAmount: number;
};

export type PremiumRequestUsageResponse = {
  timePeriod: PremiumRequestTimePeriod;
  enterprise: string;
  usageItems: PremiumRequestUsageItem[];
};

export type PremiumRequestUsageOptions = ICacheOptions & {
  year?: number;
  month?: number;
  day?: number;
  organization?: string;
  user?: string;
  model?: string;
  product?: string;
  costCenterId?: string;
};

export type GitHubCostCenterResourceType = 'User' | 'Repository' | 'Organization';
export type GitHubCostCenterResourceEntry = {
  type: GitHubCostCenterResourceType;
  name: string;
};

export type GitHubCostCenter = {
  name: string;
  id: string;
  resources: GitHubCostCenterResourceEntry[];
  state: 'active' | 'deleted';
};

export default class GitHubEnterpriseBilling {
  constructor(
    private providers: IProviders,
    readonly enterprise: GitHubEnterprise,
    private billingWriteToken: string
  ) {}

  async createCostCenter(name: string) {
    const github = this.providers.github;
    const parameters = {
      name,
      enterprise: this.enterprise.slug,
    };
    try {
      const response = await github.requestAsPostWithRequirements(
        github.createRequirementsForRequest(
          this.billingWriteToken,
          `${HttpMethod.Post} /enterprises/:enterprise/settings/billing/cost-centers`,
          {
            permissions: {
              permission: 'enterprise',
              access: 'manage_billing',
            },
          }
        ),
        parameters as any
      );
      return symbolizeApiResponse(response) as GitHubCostCenter;
    } catch (error) {
      throw error;
    }
  }

  async addUsers(costCenterId: string, logins: string[]) {
    const github = this.providers.github;
    const parameters = {
      costCenterId,
      enterprise: this.enterprise.slug,
      users: logins,
    };
    try {
      const response = await github.requestAsPostWithRequirements(
        github.createRequirementsForRequest(
          this.billingWriteToken,
          `${HttpMethod.Post} /enterprises/:enterprise/settings/billing/cost-centers/:costCenterId/resource`,
          {
            permissions: {
              permission: 'enterprise',
              access: 'manage_billing',
            },
          }
        ),
        parameters as any
      );
      return symbolizeApiResponse(response) as GitHubCostCenter;
    } catch (error) {
      throw error;
    }
  }

  async getCostCenters(options?: ICacheOptions): Promise<GitHubCostCenter[]> {
    options = options || {};
    const operations = this.providers.operations;
    const github = operations.github;
    const parameters = {
      enterprise: this.enterprise.slug,
    };
    const caching = {
      maxAgeSeconds: getMaxAgeSeconds(operations as Operations, CacheDefault.orgMembersStaleSeconds, options),
      backgroundRefresh: true,
    };
    if (options && options.backgroundRefresh === false) {
      caching.backgroundRefresh = false;
    }
    try {
      const result: any = await github.requestWithRequirements(
        github.createRequirementsForRequest(
          this.billingWriteToken,
          'GET /enterprises/:enterprise/settings/billing/cost-centers',
          {
            permissions: {
              permission: 'enterprise',
              access: 'manage_billing',
            },
          }
        ),
        parameters,
        caching
      );
      return result?.costCenters as GitHubCostCenter[];
      // return symbolizeApiResponse(result);
    } catch (error) {
      throw error;
    }
  }

  async getCostCenter(costCenterId: string, options?: ICacheOptions): Promise<GitHubCostCenter> {
    options = options || {};
    const operations = this.providers.operations;
    const github = operations.github;
    const parameters = {
      enterprise: this.enterprise.slug,
      costCenterId,
    };
    const caching = {
      maxAgeSeconds: getMaxAgeSeconds(operations as Operations, CacheDefault.orgMembersStaleSeconds, options),
      backgroundRefresh: true,
    };
    if (options && options.backgroundRefresh === false) {
      caching.backgroundRefresh = false;
    }
    try {
      const result: any = await github.requestWithRequirements(
        github.createRequirementsForRequest(
          this.billingWriteToken,
          'GET /enterprises/:enterprise/settings/billing/cost-centers/:costCenterId',
          {
            permissions: {
              permission: 'enterprise',
              access: 'manage_billing',
            },
          }
        ),
        parameters,
        caching
      );
      return result as GitHubCostCenter;
      // return symbolizeApiResponse(result);
    } catch (error) {
      throw error;
    }
  }

  async getPremiumRequestUsage(options?: PremiumRequestUsageOptions): Promise<PremiumRequestUsageResponse> {
    options = options || {};
    const operations = this.providers.operations;
    const github = operations.github;
    const parameters: Record<string, string | number> = {
      enterprise: this.enterprise.slug,
    };
    if (options.year !== undefined) {
      parameters.year = options.year;
    }
    if (options.month !== undefined) {
      parameters.month = options.month;
    }
    if (options.day !== undefined) {
      parameters.day = options.day;
    }
    if (options.organization) {
      parameters.organization = options.organization;
    }
    if (options.user) {
      parameters.user = options.user;
    }
    if (options.model) {
      parameters.model = options.model;
    }
    if (options.product) {
      parameters.product = options.product;
    }
    if (options.costCenterId) {
      parameters.cost_center_id = options.costCenterId;
    }
    // SAS URLs returned should not be cached
    const caching = NoCacheNoBackground;
    try {
      const result: any = await github.requestWithRequirements(
        github.createRequirementsForRequest(
          this.billingWriteToken,
          'GET /enterprises/:enterprise/settings/billing/premium_request/usage',
          {
            permissions: {
              permission: 'enterprise',
              access: 'manage_billing',
            },
          }
        ),
        parameters,
        caching
      );
      return symbolizeApiResponse(result) as PremiumRequestUsageResponse;
    } catch (error) {
      throw error;
    }
  }
}
