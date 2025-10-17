//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import arrayFromString from './utils/arrayFromString.js';

export default (graphApi) => {
  const environmentProvider = graphApi.environment;
  const systemAccounts = arrayFromString(environmentProvider.get('GITHUB_SYSTEM_ACCOUNT_USERNAMES'));
  return {
    logins: systemAccounts,
  };
};
