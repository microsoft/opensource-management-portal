//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ICompanySpecificEventsLinking } from './linking.js';

export * from './linking.js';

export interface ICompanySpecificEvents {
  linking?: ICompanySpecificEventsLinking;
}
