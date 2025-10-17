//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/** @type {import('prettier').Config} */

const config = {
  tabWidth: 2,
  endOfLine: 'auto',
  trailingComma: 'es5',
  singleQuote: true,
  printWidth: 110,

  overrides: [
    {
      files: ['tsconfig.json'],
      options: {
        trailingComma: 'none',
      },
    },
    {
      files: ['.devcontainer/**/*.json'],
      options: {
        trailingComma: 'none',
      },
    },
    {
      files: ['**/*.jsonc'],
      options: {
        trailingComma: 'none',
      },
    },
  ],
};

export default config;
