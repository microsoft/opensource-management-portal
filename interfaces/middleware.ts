//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { UserSettings } from '../business/entities/userSettings.js';
import type { ReposAppRequest } from './web.js';

export type ReposAppRequestWithUserSettings = ReposAppRequest & {
  userSettings?: UserSettings;
};
