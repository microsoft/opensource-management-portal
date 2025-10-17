//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { IMail, IMailProvider } from '../../../lib/mailProvider/index.js';
import type { SiteConfiguration } from '../../config.js';
import type { IProviders } from '../../providers.js';

export interface ICompanySpecificFeatureMailProvider {
  tryCreateInstance?: (providers: IProviders, config: SiteConfiguration) => IMailProvider;
  combinedRenderSendMail?: (
    providers: IProviders,
    mailTemplate: string,
    mail: IMail,
    contentOptions: Record<string, unknown>,
    sendOptions?: unknown
  ) => Promise</* receipt ID */ string>;
}
