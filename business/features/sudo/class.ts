//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ICorporateLink } from '../../../interfaces/link.js';
import type { IProviders } from '../../../interfaces/providers.js';
import type { IOrganizationSudo } from './index.js';

import { Organization } from '../../organization.js';

export abstract class OrganizationSudo implements IOrganizationSudo {
  constructor(
    protected providers: IProviders,
    protected organization: Organization
  ) {}
  abstract isSudoer(githubLogin: string, link?: ICorporateLink): Promise<boolean>;

  protected isSudoEnvironmentOff() {
    // Optional helper for debugging, if the provider chooses to respect the deployment environment
    const config = this.providers.config;
    if (config?.sudo?.organization?.off) {
      console.warn('DEBUG WARNING: Organization sudo support is turned off in the current environment');
      return true;
    }
    return false;
  }
}
