//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from '../../../business';
import { ErrorHelper } from '../../../transitional';
import { setupRepositoryReadmeSubstring } from '../strings';

export async function tryCreateReadme(repository: Repository, log: string[]): Promise<void> {
  try {
    await repository.getReadme();
    log.push(`V2: The repository already has a README Markdown file, not placing a new one.`);
    return;
  } catch (getContentError) {
    if (ErrorHelper.IsNotFound(getContentError)) {
      log.push(`V2: The repo doesn't have a README.md file yet, placing an initial one.`);
    } else {
      log.push(`V2: Error while checking for an existing README.md file: ${getContentError}`);
    }
  }

  try {
    const setupRepositoryReadme = `${setupRepositoryReadmeSubstring} :wave:
    
Please visit the website URL :point_right: for this repository to complete the setup of this repository and configure access controls.`;

    const readmeBuffer = Buffer.from(setupRepositoryReadme, 'utf-8');
    const base64Content = readmeBuffer.toString('base64');
    await repository.createFile('README.md', base64Content, `README.md: Setup instructions`);
  } catch (writeFileError) {
    if (ErrorHelper.GetStatus(writeFileError) === 422) {
      // they selected to have a README created
    } else {
      log.push(`V2: Error while attempting to place a README.md file: ${writeFileError}`);
    }
  }
}
