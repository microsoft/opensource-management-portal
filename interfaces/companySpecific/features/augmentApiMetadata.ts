//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Organization, Team } from '../../../business/index.js';

import type { AppInsightsTelemetryClient, IProviders, TeamJsonFormat } from '../../../interfaces/index.js';

export interface ICompanySpecificAugmentApiMetadata {
  augmentOrganizationClientJson?: (
    providers: IProviders,
    organization: Organization,
    standardJsonMetadata: object
  ) => object;

  augmentTeamClientJson?: (
    providers: IProviders,
    insights: AppInsightsTelemetryClient,
    team: Team,
    standardJsonMetadata: object,
    jsonFormat: TeamJsonFormat
  ) => Promise<object>;
}
