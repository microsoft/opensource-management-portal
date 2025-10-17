//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from '../../business/index.js';

export interface IAttachCompanySpecificUrls {
  getAdministrativeUnlockUrl?(repository: Repository): string;
}
