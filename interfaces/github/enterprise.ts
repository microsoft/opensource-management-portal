//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type GitHubEnterpriseAppIdentity = {
  installationId: number;
  enterpriseGraphqlNodeId: string;
  appId: number;
  clientId: string;
  visibility: 'enterprise' | 'private' | 'public';
  slug: string;
};
