//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootProcess = {
  process: ConfigProcess;
};

export type ConfigProcess = {
  get: (name: string) => string | undefined;
};
