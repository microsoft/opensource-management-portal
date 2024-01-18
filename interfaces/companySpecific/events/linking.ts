//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ICorporateLink, IProviders } from '../..';

export interface ICompanySpecificEventsLinking {
  onLink?: (providers: IProviders, link: ICorporateLink) => Promise<void>;
  onUnlink?: (providers: IProviders, corporateId: string) => Promise<void>;
}
