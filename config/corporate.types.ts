//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ConfigCorporateRootProfile } from './corporate.profile.types';
import type { ConfigCorporateRootTrainingResources } from './corporate.trainingResources.types';

export type ConfigRootCorporate = {
  corporate: ConfigCorporate;
};

export type ConfigCorporate = ConfigCorporateRootProfile & ConfigCorporateRootTrainingResources;
