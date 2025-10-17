//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import debug from 'debug';

import { Operations } from '../../business/index.js';

import type { BasicGitHubAppInstallation } from '../../business/entities/organizationSettings/organizationSetting.js';
import type { ICacheOptions, IGitHubAppInstallation } from '../../interfaces/index.js';
import { AppPurposeTypes, getAppPurposeId } from './appPurposes.js';
import { type GitHubRateLimit, type GitHubRateLimits } from './tokenManager.js';
import { GitHubAppPermission, GitHubPathPermissionDefinitionsByMethod } from './types.js';
import { AppInstallations } from './appInstallations.js';
import type { GitHubRestSpecializedCollectionHeaders } from './core.js';
import GitHubApplication from '../../business/application.js';

const debugRateLimit = debug('github:limits');

const rateLimitFreshnessMs = 1000 * 60 * 3; // 3 minutes

const goodRateLimitAvailablePercent = 0.35;

const BackgroundCacheOneWeek: ICacheOptions = {
  backgroundRefresh: true,
  maxAgeSeconds: 60 * 60 * 24 * 7, // 1 week
};

export class AppInstallation {
  private _initialized = false;
  private _entity: IGitHubAppInstallation;
  private _app: GitHubApplication;

  private _rateLimits: GitHubRateLimits;
  private _rateLimitsRefreshed: Date;
  private _rateLimitTryAttempts: number = 0;

  constructor(
    private _operations: Operations,
    public readonly organizationName: string,
    public readonly installPair: BasicGitHubAppInstallation,
    public purpose: AppPurposeTypes
  ) {
    AppInstallations.Instance.registerInstallation(this);
  }

  async initialize() {
    if (this._initialized) {
      return;
    }
    this._initialized = true;
    const { installationId } = this.installPair;
    const app = await this.app();
    if (!app) {
      // console.warn('! no app for install ' + installationId + ' in ' + this.organizationName + ' for app ' + appId + ' purpose ' + (appPurposeId || 'unknown'));
      return;
    }
    this._entity = await app.getInstallation(installationId, BackgroundCacheOneWeek);
    if (this._entity) {
      await this.refreshRateLimits();
    }
  }

  private async app() {
    if (this._app) {
      return this._app;
    }
    const install = this.installPair;
    const app = this._operations.getApplicationById(install.appId);
    if (!app) {
      const appId = install.appId;
      this._app = this._operations.initializeAppById(appId);
      return this._app;
    }
    return app;
  }

  get likelyAvailable() {
    return !!this._entity;
  }

  get valid() {
    return !!this._entity;
  }

  get information() {
    return this._entity;
  }

  asBasicPair() {
    return this.installPair;
  }

  get id() {
    return this.installPair.installationId;
  }

  asPairWithPurpose() {
    return {
      ...this.installPair,
      purpose: this.purpose,
    };
  }

  hasRecentGoodRateLimitAvailable() {
    const stats = this.getRecentGoodRateLimitAvailableWithStats();
    if (!stats) {
      return false;
    }
    return stats.outcome;
  }

  getRecentGoodRateLimitAvailableWithStats() {
    const now = new Date();
    if (!this._rateLimits || now.getTime() - this._rateLimitsRefreshed.getTime() > rateLimitFreshnessMs) {
      return false;
    }
    const core = this._rateLimits.core;
    if (!core || core.remaining === undefined) {
      return false;
    }
    const remaining = Number(core.remaining);
    const max = Number(core.limit);
    const percent = remaining / (max + 0.0);
    return {
      outcome: percent > goodRateLimitAvailablePercent,
      remaining,
      max,
      percent,
      reset: core.reset,
      installationId: this.installPair.installationId,
    };
  }

  hasTriedInitializing() {
    return this._rateLimitTryAttempts > 0;
  }

  async tryInitializeRateLimits() {
    if (!this.hasRecentGoodRateLimitAvailable()) {
      if (!this.hasTriedInitializing()) {
        await this.tryGetRecentGoodRateLimitStats();
      }
    }
  }

  async tryGetRecentGoodRateLimitStats(attempts = 2) {
    ++this._rateLimitTryAttempts;
    if (this._rateLimitTryAttempts >= attempts) {
      return this.getRecentGoodRateLimitAvailableWithStats();
    }
    const prefix = `GitHub App: ${getAppPurposeId(this.purpose)} for ${this.organizationName} (installation=${this.installPair.installationId}): `;
    try {
      await this.refreshRateLimits();
      console.log(
        `${prefix}refreshed rate limit: ${this._rateLimits?.core?.remaining}/${this._rateLimits?.core?.limit}`
      );
    } catch (error) {
      console.warn(`${prefix}error trying to refresh: ${error.message}`);
    }
    return this.getRecentGoodRateLimitAvailableWithStats();
  }

  async getRecentRateLimits() {
    const now = new Date();
    if (!this._rateLimits || now.getTime() - this._rateLimitsRefreshed.getTime() > rateLimitFreshnessMs) {
      await this.refreshRateLimits();
    }
    return this._rateLimits;
  }

  hasAnyRateLimitRemaining() {
    const core = this._rateLimits?.core;
    if (!core || core.remaining === undefined) {
      console.warn(
        `No core rate limit values available for app ${this.installPair.installationId}. Allow use.`
      );
      return true;
    }
    return core?.remaining > 0;
  }

  supportsPermission(
    httpMethod: string,
    neededPermissions: GitHubPathPermissionDefinitionsByMethod,
    installation?: AppInstallation
  ) {
    const suffix = installation
      ? ` install=${installation?.id} app=${installation?.installPair?.appId} purpose=${installation?.installPair?.appPurposeId}`
      : '';
    if (!this._entity || !httpMethod || !neededPermissions) {
      debugRateLimit(`\tcannot eval permission: no entity, httpMethod, or neededPermissions${suffix}`);
      return false;
    }
    const neededPermission = neededPermissions[httpMethod];
    if (!neededPermission || !neededPermission.permission) {
      debugRateLimit(`\tno neededPermission or permission for ${httpMethod}${suffix}`);
      return false;
    }
    const installationPermissions = this._entity.permissions;
    const scope = neededPermission.permission;
    if (!installationPermissions || !installationPermissions[scope]) {
      debugRateLimit(`\tno installationPermissions or scope ${scope}${suffix}`);
      return false;
    }
    const requiredAccess = neededPermission.access;
    const actualAccess = installationPermissions[scope] as string | GitHubAppPermission;
    const actualAccessArray = Array.isArray(actualAccess) ? actualAccess : [actualAccess];
    if (actualAccess === GitHubAppPermission.Admin) {
      actualAccessArray.push(GitHubAppPermission.Read);
      actualAccessArray.push(GitHubAppPermission.Write);
    } else if (actualAccess === GitHubAppPermission.Write) {
      actualAccessArray.push(GitHubAppPermission.Read);
    }
    if (!actualAccessArray.includes(requiredAccess)) {
      debugRateLimit(
        `\tactualAccess ${actualAccess} does not include requiredAccess ${requiredAccess}${suffix}`
      );
      return false;
    }
    debugRateLimit(`\tpermission available for ${httpMethod} ${scope} ${requiredAccess}${suffix}`);
    return true;
  }

  private async refreshRateLimits() {
    const { installationId } = this.installPair;
    const app = await this.app();
    if (!app) {
      return;
    }
    this._rateLimits = await app.getInstallationRateLimit(
      this._operations,
      this.organizationName,
      installationId
    );
    if (this._rateLimits) {
      this._rateLimitsRefreshed = new Date();
      this._rateLimitTryAttempts = 1;
    }
  }

  updateRateLimitsFromHeaders(headers: GitHubRestSpecializedCollectionHeaders) {
    const resource = headers['x-ratelimit-resource'];
    if (!resource) {
      return;
    }
    if (!this._rateLimits) {
      this._rateLimits = {
        [resource]: {
          limit: headers['x-ratelimit-limit'],
          remaining: headers['x-ratelimit-remaining'],
          reset: headers['x-ratelimit-reset'],
        },
      } as any;
      this._rateLimitsRefreshed = new Date();
      this._rateLimitTryAttempts = 1;
    }
    if (!this._rateLimits[resource]) {
      this._rateLimits[resource] = {
        limit: headers['x-ratelimit-limit'],
        remaining: headers['x-ratelimit-remaining'],
        reset: headers['x-ratelimit-reset'],
      };
      this._rateLimitsRefreshed = new Date();
      this._rateLimitTryAttempts = 1;
    }
    const currentInformation: GitHubRateLimit = this._rateLimits[resource];
    if (!currentInformation) {
      return;
    }
    this._rateLimitsRefreshed = new Date();
    this._rateLimitTryAttempts = 1;
    const limit = headers['x-ratelimit-limit'];
    const remaining = headers['x-ratelimit-remaining'];
    const reset = headers['x-ratelimit-reset'];
    if (currentInformation?.reset === reset && limit > currentInformation.limit) {
      debugRateLimit(
        `Rate limit reset time ${reset} and limit ${limit} are higher than current limit ${currentInformation.limit} for ${resource}, ignoring`
      );
    } else {
      currentInformation.limit = limit;
      currentInformation.remaining = remaining;
      currentInformation.reset = reset;
      debugRateLimit(
        `Updated rate limit for ${this.organizationName} ${getAppPurposeId(this.purpose)} ${resource} to ${remaining} remaining of ${limit} with reset at ${reset}`
      );
    }
  }
}
