//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from '../../..';

export async function tryDropCollaborator(
  repository: Repository,
  login: string,
  log: string[]
): Promise<void> {
  const organization = repository.organization;
  try {
    await repository.removeCollaborator(login);
    log.push(
      `Lockdown removed collaborator login=${login} from the repository ${repository.name} in organization ${organization.name}`
    );
  } catch (lockdownError) {
    log.push(
      `Error while removing collaborator login=${login} from the repository ${repository.name} in organization ${organization.name}: ${lockdownError.message}`
    );
  }
}
