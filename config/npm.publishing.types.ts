//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigNpmRootPublishing = {
  publishing: ConfigNpmPublishing;
};

// NOTE: this config and associated concept is no longer part of this application

export type ConfigNpmPublishing = {
  former_token: string;
  token: string;
  notify: string;
  notifyFrom: string;
};
