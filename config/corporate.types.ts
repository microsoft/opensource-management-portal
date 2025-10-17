//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ConfigCorporateRootProfile } from './corporate.profile.types.js';
import type { ConfigCorporateRootTrainingResources } from './corporate.trainingResources.types.js';

export type ConfigRootCorporate = {
  corporate: ConfigCorporate;
};

export type ConfigCorporate = ConfigCorporateRootProfile & ConfigCorporateRootTrainingResources;
