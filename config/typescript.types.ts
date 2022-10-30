//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootTypeScript = {
  typescript: ConfigTypeScript;
};

export type ConfigTypeScript = {
  dist: boolean;
  appDirectory: string;
};
