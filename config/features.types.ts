//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootFeatures = {
  features: ConfigFeatures;
};

export type ConfigFeatures = {
  allowTeamMemberToMaintainerSelfUpgrades: boolean;
  allowUnauthorizedNewRepositoryLockdownSystem: boolean;
  allowUnauthorizedForkLockdownSystem: boolean;
  allowUnauthorizedTransferLockdownSystem: boolean;
  allowUndoSystem: boolean;
  allowOrganizationSudo: boolean;
  allowPortalSudo: boolean;
  allowAdministratorManualLinking: boolean;
  allowApiClient: boolean;
  exposeWebhookIngestionEndpoint: boolean;
  allowFossFundElections: boolean;
};
