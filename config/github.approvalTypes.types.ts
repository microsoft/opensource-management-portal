//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubRootApprovalTypes = {
  approvalTypes: ConfigGitHubApprovalTypes;
};

export type ConfigGitHubApprovalTypeFields = {
  approvalTypes: string[];
  approvalUrlRequired: string[];
  exemptionDetailsRequired: string[];
  approvalTypesToIds: Record<string, string>;
  approvalIdsToReleaseType: Record<string, string>;
};

export type ConfigGitHubApprovalTypes = {
  repo: string[];
  teamJoin: string[];
  fields: ConfigGitHubApprovalTypeFields;
};
