//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootDebug = {
  debug: ConfigDebug;
};

export type ConfigDebug = {
  environmentName: string;
  showUsers: boolean;
  showDebugFooter: boolean;
  unlinkWithoutDrops: boolean;
};
