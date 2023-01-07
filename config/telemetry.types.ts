//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootTelemetry = {
  telemetry: ConfigTelemetry;
};

export type ConfigTelemetry = {
  applicationInsightsKey: string;
  applicationInsightsConnectionString: string;
  jobsApplicationInsightsConnectionKey: string;
  jobsApplicationInsightsConnectionString: string;
  googleAnalyticsKey: string;
};
