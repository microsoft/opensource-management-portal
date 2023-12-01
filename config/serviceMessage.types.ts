//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootServiceMessage = {
  serviceMessage: ConfigServiceMessage;
};

export type ConfigServiceMessage = {
  banner: string;
  link: string;
  details: string;
};
