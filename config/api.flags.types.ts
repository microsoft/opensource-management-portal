//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootApi = {
  api: ConfigApi;
};

export type ConfigApi = {
  flags: ConfigApiFlags;
};

export type ConfigApiFlags = {
  createLinks: boolean;
  publicReposFilter: boolean;
};
