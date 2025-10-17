//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Organization } from '../../index.js';
import { OrganizationSudo } from './class.js';

import type { ICorporateLink, IProviders } from '../../../interfaces/index.js';

export class OrganizationSudoNoop extends OrganizationSudo {
  constructor(
    protected providers: IProviders,
    protected organization: Organization
  ) {
    super(providers, organization);
  }

  isSudoer(githubLogin: string, link?: ICorporateLink): Promise<boolean> {
    return Promise.resolve(false);
  }
}
