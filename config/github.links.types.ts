//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ConfigGitHubLinksRootEvents } from './github.links.events.types';
import type { ConfigGitHubLinksRootPostgres } from './github.links.postgres.types';
import type { ConfigGitHubLinksRootProvider } from './github.links.provider.types';
import type { ConfigGitHubLinksRootTable } from './github.links.table.types';

export type ConfigGitHubRootLinks = {
  links: ConfigGitHubLinks;
};

export type ConfigGitHubLinks = ConfigGitHubLinksRootEvents &
  ConfigGitHubLinksRootPostgres &
  ConfigGitHubLinksRootProvider &
  ConfigGitHubLinksRootTable;
