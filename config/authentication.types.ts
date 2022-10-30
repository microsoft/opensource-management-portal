//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ConfigRootAuthenticationVsts } from './authentications.vsts.types';

export type ConfigRootAuthentication = {
  authentication: ConfigAuthentication;
};

export type ConfigAuthentication = ConfigRootAuthenticationVsts & {
  scheme: 'aad' | 'github';
};
