//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ConfigGitHubRootApi } from './github.api.types';
import type { ConfigGitHubRootApp } from './github.app.types';
import type { ConfigGitHubRootApprovals } from './github.approvals.types';
import type { ConfigGitHubRootApprovalTypes } from './github.approvalTypes.types';
import type { ConfigGitHubRootCache } from './github.cache.types';
import type { ConfigGitHubRootCodespaces } from './github.codespaces.types';
import type { ConfigGitHubRootGitIgnore } from './github.gitignore.types';
import type { ConfigGitHubRootJobs } from './github.jobs.types';
import type { ConfigGitHubRootLibrary } from './github.library.types';
import type { ConfigGitHubRootLinks } from './github.links.types';
import type { ConfigGitHubRootOAuth2 } from './github.oauth2.types';
import type { ConfigGitHubRootOperations } from './github.operations.types';
import type { ConfigGitHubRootOrganizations } from './github.organizations.types';
import type { ConfigGitHubRootRepos } from './github.repos.types';
import type { ConfigGitHubRootSystemAccounts } from './github.systemAccounts.types';
import type { ConfigGitHubRootTeams } from './github.teams.types';
import type { ConfigGitHubRootTemplates } from './github.templates.types';

import type { ConfigGitHubRootUser } from './github.user.types';
import type { ConfigGitHubRootWebhooks } from './github.webhooks.types';

export type ConfigRootGitHub = {
  github: ConfigGitHub;
};

export type ConfigGitHub = ConfigGitHubRootApi &
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
