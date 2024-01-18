//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { UserSettings } from '../business/entities/userSettings';
import type { ReposAppRequest } from './web';

export type ReposAppRequestWithUserSettings = ReposAppRequest & {
  userSettings?: UserSettings;
};
