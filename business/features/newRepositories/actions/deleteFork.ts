//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from '../../..';

export async function immediatelyDeleteFork(log: string[], repository: Repository): Promise<void> {
  const organization = repository.organization;
  try {
    log.push(`Deleting the repository ${organization.name}/${repository.name} via GitHub API`);
    await repository.delete();
    log.push(`Deleted the repository ${organization.name}/${repository.name} via GitHub API`);
  } catch (error) {
    log.push(`Error while deleting the fork in ${organization.name}/${repository.name}: ${error.message}`);
  }
}
