//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IReposApplication } from '../../interfaces';
import { CreateError } from '../../transitional';

import Debug from 'debug';
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

export abstract class CustomAppPurpose implements ICustomAppPurpose {
  get isCustomAppPurpose() {
    return true;
  }
  constructor(public id: string, public name: string) {}
}

export class CustomAppPurposeOrganizationVariance extends CustomAppPurpose {
  fallbackIfNotConfiguredOrganizationName = false;
  constructor(public id: string, public name: string, private configurations: IGitHubAppConfiguration[]) {
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
}

export class CustomAppPurposeSingleConfiguration extends CustomAppPurpose {
  constructor(public id: string, public name: string, private configuration: IGitHubAppConfiguration) {
    super(id, name);
  }

  getApplicationConfigurationForInitialization() {
    return this.configuration;
  }
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

export class GitHubAppPurposes {
  private static _instance: GitHubAppPurposes = new GitHubAppPurposes();

  static get AllAvailableAppPurposes() {
    debug(`Retrieving all available purposes (${this._instance._purposes.length})`);
    return this._instance._purposes;
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
  app: IReposApplication;
  configurations: Map<AppPurposeTypes, IGitHubAppConfiguration>;
}
