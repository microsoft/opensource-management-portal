//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootEntityProviders = {
  entityProviders: ConfigEntityProviders;
};

export type ConfigEntityProviders = {
  auditlogrecord: string;
  eventrecord: string;
  teamjoin: string;
  repositorymetadata: string;
  organizationannotations: string;
  organizationsettings: string;
  organizationmembercache: string;
  repository: string;
  repositorycache: string;
  repositorycollaboratorcache: string;
  repositoryteamcache: string;
  teamcache: string;
  teammembercache: string;
  usersettings: string;
};
