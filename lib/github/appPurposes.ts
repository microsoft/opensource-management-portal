//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ExecutionEnvironment } from '../../interfaces';
import { CreateError } from '../transitional';

import Debug from 'debug';
import { GitHubTokenManager } from './tokenManager';
import GitHubApplication from '../../business/application';
import { Operations, OperationsCore } from '../../business';

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
  getForOrganizationName?(organizationName: string): IGitHubAppConfiguration;
  getApplicationConfigurationForInitialization?(): IGitHubAppConfiguration;
}

export type AppPurposeTypes = AppPurpose | ICustomAppPurpose;

export type CustomAppPurposeWithGetApplications = ICustomAppPurpose & {
  getGitHubAppInstances: () => GitHubApplication[];
};

export abstract class CustomAppPurpose implements ICustomAppPurpose {
  get isCustomAppPurpose() {
    return true;
  }
  constructor(
    public id: string,
    public name: string
  ) {}
}

export class CustomAppPurposeOrganizationVariance extends CustomAppPurpose {
  private _appsByAppId = new Map<number, GitHubApplication>();

  fallbackIfNotConfiguredOrganizationName = false;

  constructor(
    private operations: Operations,
    public id: string,
    public name: string,
    private configurations: IGitHubAppConfiguration[]
  ) {
    super(id, name);
  }

  getForOrganizationName(organizationName: string) {
    const configuration = this.configurations.find(
      (c) => c.specificOrganizationName.toLowerCase() === organizationName.toLowerCase()
    );
    if (!configuration && this.fallbackIfNotConfiguredOrganizationName === false) {
      throw CreateError.NotFound(`No configuration found for organization ${organizationName}`);
    }
    return configuration || this.configurations[0];
  }

  getGitHubAppInstances() {
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
}

export class CustomAppPurposeSingleConfiguration extends CustomAppPurpose {
  private _appInstance: GitHubApplication;

  constructor(
    private operations: Operations,
    public id: string,
    public name: string,
    private configuration: IGitHubAppConfiguration
  ) {
    super(id, name);
  }

  getApplicationConfigurationForInitialization() {
    return this.configuration;
  }

  getGitHubAppInstances() {
    if (!this._appInstance) {
      this._appInstance = createGitHubAppInstance(this.operations, this.configuration, this);
    }
    return this._appInstance;
  }
}

function createGitHubAppInstance(
  operations: Operations,
  configuration: IGitHubAppConfiguration,
  customPurpose: AppPurposeTypes
) {
  const app = new GitHubApplication(
    operations,
    configuration.appId,
    configuration.slug,
    configuration.description || configuration.slug,
    getAppAuthorizationHeader.bind(this, operations, configuration, customPurpose)
  );
  return app;
}

async function getAppAuthorizationHeader(
  operations: Operations,
  configuration: IGitHubAppConfiguration,
  purpose: AppPurposeTypes
): Promise<string> {
  const appId = configuration.appId;
  const tokenManager = GitHubTokenManager.TryGetTokenManagerForOperations(operations);
  const appTokens = await tokenManager.ensureConfigurationAppInitialized(purpose, configuration);
  if (!appTokens) {
    CreateError.InvalidParameters(`No app tokens found configured for app ID ${appId} in tokens instance.`);
  }
  const jwt = await appTokens.getAppAuthenticationToken();
  const value = `bearer ${jwt}`;
  return value;
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
    (purpose as ICustomAppPurpose).getForOrganizationName
  ) {
    return (purpose as ICustomAppPurpose).getForOrganizationName(organizationName);
  }
}

export function tryGetAppPurposeGitHubAppInstances(purpose: AppPurposeTypes) {
  if (
    (purpose as ICustomAppPurpose).isCustomAppPurpose === true &&
    (purpose as CustomAppPurposeWithGetApplications).getGitHubAppInstances
  ) {
    return (purpose as CustomAppPurposeWithGetApplications).getGitHubAppInstances();
  }
  const operations = GitHubAppPurposes.GetOperationsInstanceForBuiltInPurposes();
  const tokenManager = GitHubTokenManager.TryGetTokenManagerForOperations(operations);
  const appTokens = tokenManager.getAppForPurpose(purpose);
  if (!appTokens) {
    throw CreateError.InvalidParameters(`No app tokens found configured for purpose ${purpose}`);
  }
  const appId = appTokens.appId;
  if (!appId) {
    throw CreateError.InvalidParameters(`No app ID found configured for purpose ${purpose}`);
  }
  return [operations.getApplicationById(appId)];
}

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

export interface IGitHubAppConfiguration {
  clientId?: string;
  clientSecret?: string;
  appId?: number;
  appKey?: string;
  appKeyFile?: string;
  webhookSecret?: string;
  slug?: string;
  description?: string;
  baseUrl?: string;

  specificOrganizationName?: string;
}

export interface IGitHubAppsOptions {
  operations: OperationsCore;
  // app: IReposApplication;
  configurations: Map<AppPurposeTypes, IGitHubAppConfiguration>;
  executionEnvironment: ExecutionEnvironment;
}
