//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const arrayFromString = require('./utils/arrayFromString');

const approvalFieldsFileVariableName = 'GITHUB_APPROVAL_FIELDS_FILE';

module.exports = function (graphApi) {
  const environmentProvider = graphApi.environment;
  const fieldsFile = environmentProvider.get(approvalFieldsFileVariableName);
  const approvalFields = fieldsFile ? require(`../data/${fieldsFile}`) : undefined;

  return {
    repo: arrayFromString(environmentProvider.get('REPO_APPROVAL_TYPES') || 'github'),
    teamJoin: arrayFromString(environmentProvider.get('TEAM_JOIN_APPROVAL_TYPES') || 'github'),
    fields: approvalFields,
  };
};
