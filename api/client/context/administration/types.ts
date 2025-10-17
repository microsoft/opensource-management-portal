//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import GitHubApplication, { type GitHubAppDefinition } from '../../../../business/application.js';
import { OrganizationSetting } from '../../../../business/entities/organizationSettings/organizationSetting.js';
import type { IGitHubAppInstallation, ReposAppRequest } from '../../../../interfaces/index.js';

export type ApiRequestWithGitHubApplication = ReposAppRequest & {
  gitHubApplication: GitHubApplication;
};

export enum ManagedOrganizationStatus {
  Active = 'Active',
  Adopted = 'Adopted',
  NotAdopted = 'NotAdopted',
}

export type ManagedOrganizationAppConfigurationsByOrgView = {
  organizationName: string;
  status: ManagedOrganizationStatus;
  appInstallations: Map<number, IByOrgViewAppInstallation>;
  dynamicSettings: OrganizationSetting;
  configuredInstallations: number[];
  id?: number;
};

export interface IByOrgViewAppInstallation {
  app: GitHubApplication;
  installationId?: number;
}

export type RequestWithInstallation = ApiRequestWithGitHubApplication & {
  installation: IGitHubAppInstallation;
  organizationDynamicSettings: OrganizationSetting;
  organizationStaticSettings: OrganizationSetting;
};

export type AdministrativeGitHubAppInstallationResponse = {
  app: GitHubAppDefinition;
  installationId: number;
  installation?: IGitHubAppInstallation;
  dynamicSettings: OrganizationSetting;
};
