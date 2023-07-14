//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootLogging = {
  logging: ConfigLogging;
};

export type ConfigLogging = {
  errors: boolean;
  version: string;
};
