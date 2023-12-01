//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootBrand = {
  brand: ConfigBrand;
};

export type ConfigBrand = {
  companyName: string;
  companyLink: string;
  companyPortalName: string;
  companyLogoSrc: string;
  appName: string;
  supportMail: string;
  operationsMail: string;
  forkApprovalMail: string;
  electionMail: string;
  infrastructureNotificationsMail: string;
};
