//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootLegalEntities = {
  legalEntities: ConfigLegalEntities;
};

export type ConfigLegalEntities = {
  entities: string[];
  defaultOrganizationEntities: string[];
};
