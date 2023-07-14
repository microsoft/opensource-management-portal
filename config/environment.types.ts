//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootEnvironment = {
  environment: ConfigEnvironment;
};

export type ConfigEnvironment = {
  name: string;
  configuration: string;
};
