//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Organization, Team } from '../../../business';
import type { IProviders, TeamJsonFormat } from '../../../interfaces';

export interface ICompanySpecificAugmentApiMetadata {
  augmentOrganizationClientJson?: (
    providers: IProviders,
    organization: Organization,
    standardJsonMetadata: object
  ) => object;

  augmentTeamClientJson?: (
    providers: IProviders,
    team: Team,
    standardJsonMetadata: object,
    jsonFormat: TeamJsonFormat
  ) => Promise<object>;
}
