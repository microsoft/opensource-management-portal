//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { GitHubCollaboratorAffiliationQuery } from '../../../interfaces';
import { tryDowngradeCollaborator } from './downgradeCollaborator';
import { tryDropCollaborator } from './dropCollaborator';
import { tryDropTeam } from './dropTeam';

export async function lockdownRepository(
  log: string[],
  systemAccounts: Set<string>,
  creatorLogin: string
): Promise<void> {
  try {
    const specialPermittedTeams = new Set([
      ...this.organization.specialRepositoryPermissionTeams.admin,
      ...this.organization.specialRepositoryPermissionTeams.write,
      ...this.organization.specialRepositoryPermissionTeams.read,
    ]);
    const teamPermissions = await this.repository.getTeamPermissions();
    for (const tp of teamPermissions) {
      if (specialPermittedTeams.has(tp.team.id)) {
        log.push(
          `Special permitted team id=${tp.team.id} name=${tp.team.name} will continue to have repository access`
        );
      } else {
        await tryDropTeam(this.repository, tp.team, log);
      }
    }
    const collaborators = await this.repository.getCollaborators({
      affiliation: GitHubCollaboratorAffiliationQuery.Direct,
    });
    for (const collaborator of collaborators) {
      if (systemAccounts.has(collaborator.login.toLowerCase())) {
        log.push(`System account ${collaborator.login} will continue to have repository access`);
      } else {
        if (collaborator.login.toLowerCase() !== creatorLogin.toLowerCase()) {
          await tryDropCollaborator(this.repository, collaborator.login, log);
        } else {
          // Downgrade the creator to only having READ access (V2)
          if (collaborator.permissions.admin || collaborator.permissions.push) {
            await tryDowngradeCollaborator(this.repository, collaborator.login, log);
          } else {
            log.push(
              `V2: Creator login ${collaborator.login} does not have administrative access (rare), not downgrading`
            );
          }
        }
      }
    }
    log.push('Lockdown of permissions complete');
  } catch (lockdownError) {
    log.push(`Error while locking down the repository: ${lockdownError.message}`);
  }
}
