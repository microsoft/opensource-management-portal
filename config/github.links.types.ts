//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ConfigGitHubLinksRootEvents } from './github.links.events.types.js';
import type { ConfigGitHubLinksRootPostgres } from './github.links.postgres.types.js';
import type { ConfigGitHubLinksRootProvider } from './github.links.provider.types.js';
import type { ConfigGitHubLinksRootTable } from './github.links.table.types.js';

export type ConfigGitHubRootLinks = {
  links: ConfigGitHubLinks;
};

export type ConfigGitHubLinks = ConfigGitHubLinksRootEvents &
  ConfigGitHubLinksRootPostgres &
  ConfigGitHubLinksRootProvider &
  ConfigGitHubLinksRootTable;
