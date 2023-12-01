//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigCorporateRootTrainingResources = {
  trainingResources: ConfigCorporateTrainingResources;
};

export type ConfigCorporateTrainingResourceLink = {
  title: string;
  link: string;
};

export type ConfigCorporateTrainingResources = {
  footer: Record<string, ConfigCorporateTrainingResourceLink[]>;

  // Legacy configuration
  'onboarding-complete': Record<string, ConfigCorporateTrainingResourceLink[]>;
  'legal-notices': ConfigCorporateTrainingResourceLink[];
  'public-homepage': ConfigCorporateTrainingResourceLink[];
};
