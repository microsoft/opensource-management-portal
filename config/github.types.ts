//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ConfigGitHubRootAnnotations } from './github.annotations.types.js';
import type { ConfigGitHubRootApi } from './github.api.types.js';
import type { ConfigGitHubRootApp } from './github.app.types.js';
import type { ConfigGitHubRootApprovals } from './github.approvals.types.js';
import type { ConfigGitHubRootApprovalTypes } from './github.approvalTypes.types.js';
import type { ConfigGitHubRootCache } from './github.cache.types.js';
import type { ConfigGitHubRootCodespaces } from './github.codespaces.types.js';
import type { ConfigGitHubRootGitIgnore } from './github.gitignore.types.js';
import type { ConfigGitHubRootJobs } from './github.jobs.types.js';
import type { ConfigGitHubRootLibrary } from './github.library.types.js';
import type { ConfigGitHubRootLinks } from './github.links.types.js';
import type { ConfigGitHubRootOAuth2 } from './github.oauth2.types.js';
import type { ConfigGitHubRootOperations } from './github.operations.types.js';
import type { ConfigGitHubRootOrganizations } from './github.organizations.types.js';
import type { ConfigGitHubRootRepos } from './github.repos.types.js';
import type { ConfigGitHubRootSystemAccounts } from './github.systemAccounts.types.js';
import type { ConfigGitHubRootTeams } from './github.teams.types.js';
import type { ConfigGitHubRootTemplates } from './github.templates.types.js';

import type { ConfigGitHubRootUser } from './github.user.types.js';
import type { ConfigGitHubRootWebhooks } from './github.webhooks.types.js';

export type ConfigRootGitHub = {
  github: ConfigGitHub;
};

export type ConfigGitHub = ConfigGitHubRootApi &
  ConfigGitHubRootAnnotations &
  ConfigGitHubRootApp &
  ConfigGitHubRootApprovals &
  ConfigGitHubRootApprovalTypes &
  ConfigGitHubRootCache &
  ConfigGitHubRootCodespaces &
  ConfigGitHubRootGitIgnore &
  ConfigGitHubRootJobs &
  ConfigGitHubRootLibrary &
  ConfigGitHubRootLinks &
  ConfigGitHubRootOAuth2 &
  ConfigGitHubRootOperations &
  ConfigGitHubRootOrganizations &
  ConfigGitHubRootRepos &
  ConfigGitHubRootSystemAccounts &
  ConfigGitHubRootTeams &
  ConfigGitHubRootTemplates &
  ConfigGitHubRootUser &
  ConfigGitHubRootWebhooks;
