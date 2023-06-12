//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// eslint-disable-next-line n/no-unpublished-import
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  transform: {
    '^.+\\.(js|ts|tsx)?$': 'ts-jest',
  },
};

export default config;
