//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import arrayFromString from './utils/arrayFromString.js';

const administratorsEnvironmentName = 'AUTHORIZED_CORPORATE_ADMINISTRATOR_USERNAMES';
const administratorsGroupEnvironmentName = 'AUTHORIZED_CORPORATE_ADMINISTRATOR_SECURITY_GROUP_ID';

export default function (graphApi) {
  const environmentProvider = graphApi.environment;
  const value = environmentProvider.get(administratorsEnvironmentName);

  const values = {
    corporateUsernames: arrayFromString(value || ''),
    corporateSecurityGroup: environmentProvider.get(administratorsGroupEnvironmentName),
  };
  return values;
}
