//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IProviders } from '../../interfaces';
import { ErrorHelper } from '../../transitional';

export async function isAuthorizedSystemAdministrator(
  providers: IProviders,
  corporateId: string,
  corporateUsername: string
): Promise<boolean> {
  const { insights, config } = providers;
  const insightsPrefix = 'SystemAdministrator';
  if (!corporateId && !corporateUsername) {
    return false;
  }
  const groupId = config?.administrators?.corporateSecurityGroup as string;
  if (groupId && corporateId) {
    try {
      if (await providers.graphProvider.isUserInGroup(corporateId, groupId)) {
        insights?.trackEvent({
          name: `${insightsPrefix}AuthorizedGroupMembership`,
          properties: {
            corporateId: corporateId,
            securityGroupId: groupId,
          },
        });
        return true;
      }
    } catch (error) {
      if (!ErrorHelper.IsNotFound(error)) {
        // security groups do get deleted and should not bring down any system in that case
        console.warn(error);
        insights?.trackException({
          exception: error,
          properties: {
            eventName: `${insightsPrefix}SecurityGroupError`,
            className: 'OperationsAdministration',
            callName: 'isAuthorizedSystemAdministrator',
            corporateId: corporateId,
            securityGroupId: groupId,
          },
        });
      }
    }
  }
  if (corporateUsername) {
    const administratorUsernames: string[] = config?.administrators?.corporateUsernames || [];
    const username = corporateUsername.toLowerCase();
    for (const admin of administratorUsernames) {
      if (username === admin.toLowerCase()) {
        insights?.trackEvent({
          name: `${insightsPrefix}AuthorizedUsername`,
          properties: {
            corporateUsername,
          },
        });
        return true;
      }
    }
  }
  return false;
}
