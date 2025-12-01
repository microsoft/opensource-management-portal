//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import path from 'path';
import fs from 'fs';
import debug from 'debug';

import arrayFromString from './utils/arrayFromString.js';
import createEnvironmentFileResolver from './environmentFileReader.js';
import typescriptConfig from './typescript.js';

const debugStartup = debug('startup');

const approvalFieldsFileVariableName = 'GITHUB_APPROVAL_FIELDS_FILE';

const showTypeLoadDebugMessages = false;

const resolver = createEnvironmentFileResolver(
  'github.approvalTypes.js',
  'repo.approvals',
  'CONFIGURATION_ENVIRONMENT',
  {
    before: async (graphApi) => {
      const environmentProvider = graphApi.environment;
      const fieldsFile = environmentProvider.get(approvalFieldsFileVariableName);
      if (fieldsFile) {
        // Legacy environment approach:
        // Look for the approval fields file and use that for the approval data, used by
        // the original open source project implementation.
        try {
          const filename = path.join(typescriptConfig.appDirectory, 'data', `${fieldsFile}.json`);
          const str = fs.readFileSync(filename, 'utf8');
          const approvalFields = JSON.parse(str);
          showTypeLoadDebugMessages && debugStartup(`repo approval types loaded from file ${filename}`);
          return approvalFields;
        } catch (notFound) {
          console.warn(notFound);
          // will then fallback to newer painless config approach
        }
      }
    },
    after: (graphApi, data) => {
      const environmentProvider = graphApi.environment;
      const approvalFields = data;
      return {
        repo: arrayFromString(environmentProvider.get('REPO_APPROVAL_TYPES') || 'github'),
        teamJoin: arrayFromString(environmentProvider.get('TEAM_JOIN_APPROVAL_TYPES') || 'github'),
        fields: approvalFields,
      };
    },
  }
);

export default resolver;
