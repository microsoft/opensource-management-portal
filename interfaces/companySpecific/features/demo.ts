//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IndividualContext } from '../../../business/user';

export interface ICompanySpecificFeatureDemo {
  isDemoUser: (activeContext: IndividualContext) => boolean;
  getDemoUsers(): IDemoUser[];
}

export interface IDemoUser {
  login: string;
  avatar: string;
  displayName: string;
  alias: string;
}
