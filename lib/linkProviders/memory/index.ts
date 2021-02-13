//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { MemoryLinkProvider } from './memoryLinkProvider';

export default function createMemoryProvider(providers, config) {
  const memoryOptions = {};
  return new MemoryLinkProvider(providers, memoryOptions);
}
