//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigClientRootFlighting = {
  flighting: ConfigClientFlighting;
};

export type ConfigClientFlighting = {
  enabled: boolean;

  divertEveryone: boolean;

  // RICH_TYPE_WARNING: this will break if someone tries overriding with a string/env-var
  corporateIds: string[];

  // RICH_TYPE_WARNING: this will break if someone tries overriding with a string/env-var
  featureFlagUsers: Record<string, string[]>;
};
