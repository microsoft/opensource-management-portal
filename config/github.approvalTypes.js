//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import fs from 'fs';
import path from 'path';
import debug from 'debug';
const debugStartup = debug('startup');

// import pkg from '../package.json' with { type: 'json' };
// eslint as of 2024-04-01 does not support the assert syntax yet
import { fileURLToPath, pathToFileURL } from 'url';
const isWindows = process.platform === 'win32';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const pkg = JSON.parse(fs.readFileSync(path.join(dirname, '../package.json'), 'utf8'));

const painlessConfigEnvPkgName = 'painlessConfigEnvironments';
const repoApprovalsEnvironmentName = 'repo.approvals';

import arrayFromString from './utils/arrayFromString.js';
import typescriptConfig from './typescript.js';

const approvalFieldsFileVariableName = 'GITHUB_APPROVAL_FIELDS_FILE';
const painlessConfigEnvironmentVariableName = 'CONFIGURATION_ENVIRONMENT';

const showTypeLoadDebugMessages = false;

function importPathSchemeChangeIfWindows(npmName) {
  if (isWindows && path.isAbsolute(npmName)) {
    const normalized = path.normalize(npmName);
    const fileUrl = pathToFileURL(normalized);
    return fileUrl.href;
  }
  return npmName;
}

export default async function (graphApi) {
  const environmentProvider = graphApi.environment;
  const fieldsFile = environmentProvider.get(approvalFieldsFileVariableName);
  const environmentName =
    environmentProvider.get(painlessConfigEnvironmentVariableName) || environmentProvider.get('ENV');
  let approvalFields = undefined;
  if (fieldsFile) {
    // Environment approach 1 (legacy):
    // Look for the approval fields file and use that for the approval data
    try {
      const filename = path.join(typescriptConfig.appDirectory, 'data', `${fieldsFile}.json`);
      const str = fs.readFileSync(filename, 'utf8');
      approvalFields = JSON.parse(str);
      showTypeLoadDebugMessages && debugStartup(`repo approval types loaded from file ${filename}`);
    } catch (notFound) {
      console.warn(notFound);
    }
  } else if (pkg && pkg[painlessConfigEnvPkgName] && environmentName) {
    // Painless config environment approach 2 (newer):
    // Uses the painless config environment + separate env type to get the data
    // This is also a partial hack; if there are multiple environments, this will fail.
    let pkgName = pkg[painlessConfigEnvPkgName];
    if (pkgName.startsWith('./')) {
      pkgName = path.join(typescriptConfig.appDirectory, pkgName);
    }
    if (!pkgName.endsWith('.js')) {
      pkgName = path.join(pkgName, 'index.js');
    }
    try {
      pkgName = importPathSchemeChangeIfWindows(pkgName);
      const imported = await import(pkgName);
      const inc = imported.default || imported;
      approvalFields = await inc(environmentName, repoApprovalsEnvironmentName);
      showTypeLoadDebugMessages &&
        debugStartup(
          `repo approval types loaded from painlessConfigEnvPkgName/${environmentName},${repoApprovalsEnvironmentName}`
        );
    } catch (painlessConfigError) {
      debugStartup(
        `attempted to load repo approval types loaded from painlessConfigEnvPkgName/${environmentName},${repoApprovalsEnvironmentName}`
      );
      console.warn(painlessConfigError);
    }
  }

  return {
    repo: arrayFromString(environmentProvider.get('REPO_APPROVAL_TYPES') || 'github'),
    teamJoin: arrayFromString(environmentProvider.get('TEAM_JOIN_APPROVAL_TYPES') || 'github'),
    fields: approvalFields,
  };
}
