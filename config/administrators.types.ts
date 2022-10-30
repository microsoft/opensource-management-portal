//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootAdministrators = {
  administrators: ConfigAdministrators;
};

export type ConfigAdministrators = {
  corporateUsernames: string[];
  corporateSecurityGroup: string;
};
