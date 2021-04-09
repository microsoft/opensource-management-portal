//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export interface IGitHubCollaboratorPermissions {
  admin: boolean;
  pull: boolean;
  push: boolean;
  // triage and maintain do not appear today by the GitHub API (sigh), it's in V4 GraphQL but not in V3 REST
}
