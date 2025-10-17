//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { describe, expect, it, test } from 'vitest';

import { TestGraphProvider } from './__mocks__/testGraphProvider.js';

test('testGraphProvider', async () => {
  const graphProvider = new TestGraphProvider();
  const user = await graphProvider.getUserById('1');
  expect(user.displayName).toEqual('User One');
  expect(user.jobTitle).toEqual('Engineering Manager');
});
