//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { Organization } from '../../index.js';
import getCompanySpecificDeployment from '../../../middleware/companySpecificDeployment.js';
import { ICorporateLink, IProviders } from '../../../interfaces/index.js';

export interface IOrganizationSudo {
  isSudoer(githubLogin: string, link?: ICorporateLink): Promise<boolean>;
}

export interface IPortalSudo {
  isSudoer(githubLogin: string, link?: ICorporateLink): Promise<boolean>;
}

export { OrganizationFeatureSecurityGroupProperty } from './securityGroup.js';

export * from './portal.js';

import { OrganizationSudoNoop } from './noop.js';
import { OrganizationSudoSecurityGroup } from './securityGroup.js';
import { OrganizationSudoGitHubTeams } from './teams.js';

export function createOrganizationSudoInstance(
  providers: IProviders,
  organization: Organization
): IOrganizationSudo {
  const override = getCompanySpecificDeployment();
  let instance = override?.features?.organizationSudo?.tryCreateInstance(providers, organization);
  if (instance) {
    return instance;
  }

  const config = providers.config;
  const defaultProviderName = config?.sudo?.organization?.defaultProviderName;

  let providerName = defaultProviderName;

  const allowUniqueProvidersByOrganization = config?.sudo?.organization?.allowUniqueProvidersByOrganization;
  if (allowUniqueProvidersByOrganization) {
    const name = getProviderNameForOrganization(organization);
    if (name) {
      providerName = name;
    }
  }

  instance = createProviderInstance(providerName, providers, organization);
  return instance;
}

function getProviderNameForOrganization(organization: Organization) {
  if (OrganizationSudoSecurityGroup.forOrganization(organization)) {
    return OrganizationSudoSecurityGroup.providerName;
  }
}

function createProviderInstance(providerName: string, providers: IProviders, organization: Organization) {
  switch (providerName) {
    case 'noop':
      return new OrganizationSudoNoop(providers, organization);
    case 'githubteams':
      return new OrganizationSudoGitHubTeams(providers, organization);
    case OrganizationSudoSecurityGroup.providerName:
      return new OrganizationSudoSecurityGroup(providers, organization);
    default:
      throw new Error(`OrganizationSudo: unsupported or unconfigured provider name=${providerName}`);
  }
}
