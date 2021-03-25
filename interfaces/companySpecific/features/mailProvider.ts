//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IMailProvider } from '../../../lib/mailProvider';

export interface ICompanySpecificFeatureMailProvider {
  tryCreateInstance: (config: any) => IMailProvider;
}
