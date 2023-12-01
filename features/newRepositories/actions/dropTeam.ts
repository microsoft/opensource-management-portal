//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository, Team } from '../../../business';

export async function tryDropTeam(repository: Repository, team: Team, log: string[]): Promise<void> {
  const organization = repository.organization;
  try {
    await repository.removeTeamPermission(team.id);
    log.push(
      `Lockdown removed team id=${team.id} name=${team.name} from the repository ${repository.name} in organization ${organization.name}`
    );
  } catch (lockdownError) {
    log.push(
      `Error while removing team id=${team.id} name=${team.name} permission from the repository ${repository.name} in organization ${organization.name}: ${lockdownError.message}`
    );
  }
}
