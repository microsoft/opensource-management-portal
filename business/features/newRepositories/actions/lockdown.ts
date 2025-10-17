//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from '../../../index.js';
import { GitHubCollaboratorAffiliationQuery } from '../../../../interfaces/index.js';
import { tryDowngradeCollaborator } from './downgradeCollaborator.js';
import { tryDropCollaborator } from './dropCollaborator.js';
import { tryDropTeam } from './dropTeam.js';

export async function lockdownRepository(
  log: string[],
  repository: Repository,
  systemAccounts: Set<string>,
  creatorLogin: string
): Promise<void> {
  const organization = repository.organization;
  try {
    const specialPermittedTeams = new Set([
      ...organization.specialSystemTeams.admin,
      ...organization.specialSystemTeams.write,
      ...organization.specialSystemTeams.read,
    ]);
    const teamPermissions = await repository.getTeamPermissions();
    for (const tp of teamPermissions) {
      if (specialPermittedTeams.has(tp.team.id)) {
        log.push(
          `Special permitted team id=${tp.team.id} name=${tp.team.name} will continue to have repository access`
        );
      } else {
        await tryDropTeam(repository, tp.team, log);
      }
    }
    const collaborators = await repository.getCollaborators({
      affiliation: GitHubCollaboratorAffiliationQuery.Direct,
    });
    for (const collaborator of collaborators) {
      if (systemAccounts.has(collaborator.login.toLowerCase())) {
        log.push(`System account ${collaborator.login} will continue to have repository access`);
      } else {
        if (collaborator.login.toLowerCase() !== creatorLogin.toLowerCase()) {
          await tryDropCollaborator(repository, collaborator.login, log);
        } else {
          // Downgrade the creator to only having READ access
          if (collaborator.permissions.admin || collaborator.permissions.push) {
            await tryDowngradeCollaborator(repository, collaborator.login, log);
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
