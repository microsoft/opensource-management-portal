//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import Debug from 'debug';

import { CreateError } from '../transitional.js';
import { GitHubTokenManager } from './tokenManager.js';
import GitHubApplication from '../../business/application.js';
import { Operations } from '../../business/index.js';
import { GitHubAppTokens } from './appTokens.js';

import type {
  AppInsightsTelemetryClient,
  ExecutionEnvironment,
  GitHubEnterpriseAppIdentity,
} from '../../interfaces/index.js';

const debug = Debug('github:tokens');

export enum AppPurpose {
  Data = 'Data',
  CustomerFacing = 'CustomerFacing',
  Operations = 'Operations',
  BackgroundJobs = 'BackgroundJobs', // "secondary" / "default" fallback
  Updates = 'Updates',
  Security = 'Security',
  ActionsData = 'ActionsData',
}

export interface ICustomAppPurpose {
  isCustomAppPurpose: boolean; // basic type check
  id: string;
  name: string;
  getForTargetName?(organizationName: string): GitHubAppConfiguration;
  getApplicationConfigurationForInitialization?(): GitHubAppConfiguration;
}

export type AppPurposeTypes = AppPurpose | ICustomAppPurpose;

export function isCustomAppPurpose(purpose: AppPurposeTypes): purpose is ICustomAppPurpose {
  return (purpose as ICustomAppPurpose)?.isCustomAppPurpose === true;
}

export type GetAwaitedString = () => Promise<string>;

export type CustomAppPurposeWithGetAppInstance = ICustomAppPurpose & {
  getGitHubAppInstance: () => GitHubApplication;
};

export function isCustomAppPurposeWithGetAppInstance(
  purpose: AppPurposeTypes
): purpose is CustomAppPurposeWithGetAppInstance {
  return (
    (purpose as ICustomAppPurpose)?.isCustomAppPurpose === true &&
    typeof (purpose as CustomAppPurposeWithGetAppInstance).getGitHubAppInstance === 'function'
  );
}

export type CustomAppPurposeWithGetTargetedAppInstances = ICustomAppPurpose & {
  getGitHubAppInstanceForTargetName: (targetName: string) => GitHubApplication;
};

export function isCustomAppPurposeWithGetTargetedAppInstance(
  purpose: AppPurposeTypes
): purpose is CustomAppPurposeWithGetTargetedAppInstances {
  return (
    (purpose as ICustomAppPurpose)?.isCustomAppPurpose === true &&
    typeof (purpose as CustomAppPurposeWithGetTargetedAppInstances).getGitHubAppInstanceForTargetName ===
      'function'
  );
}

export abstract class CustomAppPurpose implements ICustomAppPurpose {
  get isCustomAppPurpose() {
    return true;
  }
  constructor(
    public id: string,
    public name: string
  ) {}
}

export interface IAppPurposeAuthorizedEnterpriseSlugs extends CustomAppPurpose {
  getAuthorizedEnterpriseSlugs(): string[];
}

export function isAppPurposeAuthorizedEnterpriseSlugs(
  purpose: AppPurposeTypes
): purpose is ICustomAppPurpose & IAppPurposeAuthorizedEnterpriseSlugs {
  return typeof (purpose as IAppPurposeAuthorizedEnterpriseSlugs).getAuthorizedEnterpriseSlugs === 'function';
}

export interface IAppPurposeEnterpriseConfiguration extends CustomAppPurpose {
  getEnterpriseConfiguration(slug: string): GitHubEnterpriseAppIdentity;
}

export function isAppPurposeWithEnterpriseConfiguration(
  purpose: AppPurposeTypes
): purpose is ICustomAppPurpose & IAppPurposeEnterpriseConfiguration {
  const cast = purpose as IAppPurposeEnterpriseConfiguration;
  return cast && typeof cast.getEnterpriseConfiguration === 'function';
}

export type EnterpriseAppKeyLocations = {
  keyFile?: string;
  remoteJwt?: string;
};

export interface IAppPurposeEnterpriseKeys extends CustomAppPurpose {
  getEnterpriseKeys(slug: string): EnterpriseAppKeyLocations;
}

export function isAppPurposeWithEnterpriseKeyLocations(
  purpose: AppPurposeTypes
): purpose is ICustomAppPurpose & IAppPurposeEnterpriseKeys {
  const cast = purpose as IAppPurposeEnterpriseKeys;
  return cast && typeof cast.getEnterpriseKeys === 'function';
}

export class CustomAppPurposeTargetConfigurationVaries extends CustomAppPurpose {
  private _appsByAppId = new Map<number, GitHubApplication>();

  fallbackIfNotConfiguredTargetName = false;

  constructor(
    private operations: Operations,
    public id: string,
    public name: string,
    private targetType: 'organization' | 'enterprise',
    private configurations: GitHubAppConfiguration[]
  ) {
    super(id, name);
  }

  getForTargetName(targetName: string) {
    const configuration = this.configurations.find(
      (c) => c.specificTargetName.toLowerCase() === targetName.toLowerCase()
    );
    if (!configuration && this.fallbackIfNotConfiguredTargetName === false) {
      throw CreateError.NotFound(`No configuration found for ${this.targetType} ${targetName}`);
    }
    return configuration || this.configurations[0];
  }

  private getAppInstances() {
    const uniqueAppIds = new Set<number>(this.configurations.map((c) => c.appId).filter((id) => !!id));
    const appInstances: GitHubApplication[] = [];
    for (const appId of uniqueAppIds) {
      let instance = this._appsByAppId.get(appId);
      if (!instance) {
        instance = createGitHubAppInstance(
          this.operations,
          this.configurations.find((c) => c.appId === appId),
          this
        );
        this._appsByAppId.set(appId, instance);
      }
      appInstances.push(instance);
    }
    return appInstances;
  }

  getGitHubAppInstanceForTargetName(targetName: string) {
    const appConfig = this.getForTargetName(targetName);
    const appId = appConfig.appId;
    if (!appId) {
      throw CreateError.InvalidParameters(
        `No app ID configuration found with configuration for ${this.targetType} ${targetName}`
      );
    }
    const instances = this.getAppInstances().filter((app) => app.id === appId);
    if (instances.length === 0) {
      throw CreateError.InvalidParameters(
        `No app instance found initialized with configuration for ${this.targetType} ${targetName}`
      );
    }
    return instances[0];
  }
}

export class CustomEnterpriseAppPurpose
  extends CustomAppPurposeTargetConfigurationVaries
  implements
    IAppPurposeEnterpriseConfiguration,
    IAppPurposeAuthorizedEnterpriseSlugs,
    IAppPurposeEnterpriseKeys
{
  constructor(
    operations: Operations,
    id: string,
    name: string,
    configurations: GitHubAppConfiguration[],
    private getAuthorizedEnterpriseSlugsFunc: () => string[],
    private getEnterpriseConfigurationFunc: (slug: string) => GitHubEnterpriseAppIdentity,
    private getEnterpriseKeysFunc: (slug: string) => EnterpriseAppKeyLocations
  ) {
    super(operations, id, name, 'enterprise', configurations);
  }

  getEnterpriseKeys(slug: string): EnterpriseAppKeyLocations {
    return this.getEnterpriseKeysFunc(slug);
  }

  getAuthorizedEnterpriseSlugs() {
    return this.getAuthorizedEnterpriseSlugsFunc();
  }

  getEnterpriseConfiguration(slug: string): GitHubEnterpriseAppIdentity {
    return this.getEnterpriseConfigurationFunc(slug);
  }
}

export class CustomAppPurposeSingleConfiguration extends CustomAppPurpose {
  private _appInstance: GitHubApplication;

  constructor(
    private operations: Operations,
    public id: string,
    public name: string,
    private configuration: GitHubAppConfiguration
  ) {
    super(id, name);
  }

  getApplicationConfigurationForInitialization() {
    return this.configuration;
  }

  getGitHubAppInstance() {
    if (!this._appInstance) {
      this._appInstance = createGitHubAppInstance(this.operations, this.configuration, this);
    }
    return this._appInstance;
  }
}

function createGitHubAppInstance(
  operations: Operations,
  configuration: GitHubAppConfiguration,
  customPurpose: AppPurposeTypes
) {
  const app = new GitHubApplication(
    operations,
    configuration.appId,
    configuration.slug,
    configuration.description || configuration.slug,
    getAppCertificateSha256.bind(this, operations, configuration, customPurpose),
    getAppAuthorizationHeader.bind(this, operations, configuration, customPurpose)
  );
  return app;
}

async function getAppTokensInstance(
  operations: Operations,
  configuration: GitHubAppConfiguration,
  purpose: AppPurposeTypes
): Promise<GitHubAppTokens> {
  const appId = configuration.appId;
  const tokenManager = GitHubTokenManager.TryGetTokenManagerForOperations(operations);
  const appTokens = await tokenManager.ensureConfigurationAppInitialized(purpose, configuration);
  if (!appTokens) {
    CreateError.InvalidParameters(`No app tokens found configured for app ID ${appId} in tokens instance.`);
  }
  return appTokens;
}

async function getAppAuthorizationHeader(
  operations: Operations,
  configuration: GitHubAppConfiguration,
  purpose: AppPurposeTypes
): Promise<string> {
  const appTokens = await getAppTokensInstance(operations, configuration, purpose);
  const jwt = await appTokens.getAppAuthenticationToken();
  const value = `bearer ${jwt}`;
  return value;
}

async function getAppCertificateSha256(
  operations: Operations,
  configuration: GitHubAppConfiguration,
  purpose: AppPurposeTypes
): Promise<string> {
  const appTokens = await getAppTokensInstance(operations, configuration, purpose);
  return appTokens.getCertificateSha256();
}

export const DefinedAppPurposes = [
  AppPurpose.Data,
  AppPurpose.CustomerFacing,
  AppPurpose.Operations,
  AppPurpose.BackgroundJobs,
  AppPurpose.Updates,
  AppPurpose.Security,
  AppPurpose.ActionsData,
];

// export const GitHubAppPurposesExemptFromAllRepositoriesSelection = [AppPurpose.Onboarding];

const appPurposeToConfigurationName = {
  [AppPurpose.Data]: 'data',
  [AppPurpose.CustomerFacing]: 'ui',
  [AppPurpose.Operations]: 'operations',
  [AppPurpose.BackgroundJobs]: 'jobs',
  [AppPurpose.Updates]: 'updates',
  [AppPurpose.Security]: 'security',
  [AppPurpose.ActionsData]: 'actions',
};

export function getAppPurposeId(purpose: AppPurposeTypes) {
  if (!purpose) {
    return 'n/a';
  }
  if ((purpose as ICustomAppPurpose).isCustomAppPurpose === true) {
    return (purpose as ICustomAppPurpose).id;
  }
  const asPurpose = purpose as AppPurpose;
  const id = appPurposeToConfigurationName[asPurpose];
  if (!id) {
    throw new Error(`No configuration name for purpose ${asPurpose}`);
  }
  return id;
}

export function tryGetAppPurposeAppConfiguration(purpose: AppPurposeTypes, organizationName: string) {
  if (
    (purpose as ICustomAppPurpose).isCustomAppPurpose === true &&
    (purpose as ICustomAppPurpose).getForTargetName
  ) {
    return (purpose as ICustomAppPurpose).getForTargetName(organizationName);
  }
}

// export async function tryGetAppPurposeGitHubAppInstances(purpose: AppPurposeTypes) {
//   if (
//     (purpose as ICustomAppPurpose).isCustomAppPurpose === true &&
//     (purpose as CustomAppPurposeWithGetApplications).getGitHubAppInstances
//   ) {
//     return (purpose as CustomAppPurposeWithGetApplications).getGitHubAppInstances();
//   }
//   const operations = GitHubAppPurposes.GetOperationsInstanceForBuiltInPurposes();
//   const tokenManager = GitHubTokenManager.TryGetTokenManagerForOperations(operations);
//   const appTokens = await tokenManager.getAppForPurpose(purpose);
//   if (!appTokens) {
//     throw CreateError.InvalidParameters(`No app tokens found configured for purpose ${purpose}`);
//   }
//   const appId = appTokens.appId;
//   if (!appId) {
//     throw CreateError.InvalidParameters(`No app ID found configured for purpose ${purpose}`);
//   }
//   return [operations.getApplicationById(appId)];
// }

export class GitHubAppPurposes {
  private _operations: Operations;
  private static _instance: GitHubAppPurposes = new GitHubAppPurposes();

  static get AllAvailableAppPurposes() {
    debug(`Retrieving all available purposes (${this._instance._purposes.length})`);
    return this._instance._purposes;
  }

  static RegisterOperationsInstanceForBuiltInPurposes(operations: Operations) {
    this._instance._operations = operations;
  }

  static GetOperationsInstanceForBuiltInPurposes() {
    return this._instance._operations;
  }

  static RegisterCustomPurpose(purpose: ICustomAppPurpose) {
    debug(`Registering custom purpose ${purpose.id} (${purpose.name})`);
    if (purpose.isCustomAppPurpose !== true) {
      throw new Error('Purpose must have `isCustomAppPurpose` set to true');
    }
    if (
      (this._instance._purposes as ICustomAppPurpose[])
        .filter((p) => (p as ICustomAppPurpose)?.isCustomAppPurpose === true)
        .find((p) => p.id === purpose.id)
    ) {
      throw new Error(`Purpose with ID ${purpose.id} already registered`);
    }
    this._instance._purposes.push(purpose);
  }

  private _purposes: AppPurposeTypes[];

  constructor() {
    this._purposes = [...DefinedAppPurposes];
  }
}

export enum GitHubAppAuthenticationType {
  ForceSpecificInstallation = 'force',
  BestAvailable = 'best',
}

export type GitHubAppConfiguration = {
  clientId?: string;
  clientSecret?: string;
  appId?: number;
  appKey?: string;
  appKeyFile?: string;
  appKeyRemoteJwt?: string; // remote JWT location for key vault connection
  webhookSecret?: string;
  slug?: string;
  description?: string;
  baseUrl?: string;

  specificTargetName?: string;
};

export type GitHubAppsOptions = {
  operations: Operations;
  insights: AppInsightsTelemetryClient;
  // app: IReposApplication;
  configurations: Map<AppPurposeTypes, GitHubAppConfiguration>;
  executionEnvironment: ExecutionEnvironment;
};
