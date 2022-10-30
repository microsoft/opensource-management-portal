//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootNotifications = {
  notifications: ConfigNotifications;
};

export type ConfigNotifications = {
  linksMailAddress: string;
  reposMailAddress: string;
  reposNotificationExcludeForUsers: string;
  reposNotificationExcludeManagerForUserIds: string;

  skipDedicatedNewRepoMail: boolean;
};
