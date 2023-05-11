//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootNode = {
  node: ConfigNode;
};

export type ConfigNode = {
  environment: string;
  version: string;
  isProduction: boolean;
};
