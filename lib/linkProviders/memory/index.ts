//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { MemoryLinkProvider } from './memoryLinkProvider';

module.exports = function createProvider(providers, config) {
  const memoryOptions = {};
  return new MemoryLinkProvider(providers, memoryOptions);
};
