//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ConfigNpmRootPublishing } from './npm.publishing.types';

export type ConfigRootNpm = {
  npm: ConfigNpm;
};

export type ConfigNpm = ConfigNpmRootPublishing & {
  privateFeedScope: string;
};
