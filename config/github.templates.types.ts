//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigGitHubRootTemplates = {
  templates: ConfigGitHubTemplates;
};

export type ConfigGitHubTemplateDefinitionPermission = {
  username: string;
  acceptInvitationToken: string;
  contact: string;
};

export type ConfigGitHubTemplateDefinition = {
  spdx: string;
  name: string;
  legalEntity: string;
  forceForReleaseType: string;
  webhook: string;
  webhookEvents: string[];
  webhookFriendlyName: string;
  webhookSharedSecret: string;
  environments: string[];
  collaborators: Record<string, ConfigGitHubTemplateDefinitionPermission[]>;
};

export type ConfigGitHubTemplates = {
  directory: string;
  definitions: unknown;
  defaultTemplates: string[];
};
