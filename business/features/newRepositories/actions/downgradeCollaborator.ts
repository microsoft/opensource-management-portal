//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from '../../..';
import { GitHubRepositoryPermission } from '../../../../interfaces';

export async function tryDowngradeCollaborator(
  repository: Repository,
  login: string,
  log: string[]
): Promise<void> {
  const organization = repository.organization;
  try {
    await repository.addCollaborator(login, GitHubRepositoryPermission.Pull);
    log.push(
      `V2: Lockdown downgraded collaborator login=${login} from the repository ${repository.name} in organization ${organization.name} to READ/pull`
    );
  } catch (lockdownError) {
    log.push(
      `V2: Error while downgrading collaborator login=${login} from the repository ${repository.name} in organization ${organization.name} to READ/pull: ${lockdownError.message}`
    );
  }
}
