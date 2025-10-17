//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootWeb = {
  web: ConfigWeb;
};

export type ConfigWeb = {
  app: string;
  largeApiPayloadLimit: string;
};
