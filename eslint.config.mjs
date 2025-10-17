//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import globals from 'globals';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import pluginSecurity from 'eslint-plugin-security';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  pluginSecurity.configs.recommended,
  {
    rules: {
      // These are so common in Node codebases it does not provide sufficient value to warn
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    ignores: [
      '.github/build/*.cjs',
      '.github/build/*.js',
      'default-assets-package/thirdparty/**/*.js',
      'dist/**/*.js',
      'dist/**/*.mjs',
      'dist/**/*.d.ts',
      '.environment/validate.js',
      '.ossdev/build/*.cjs',
      '**/frontend/',
      '**/vendor/**/*',
      'views/js/**/*',
      '.eslint.config.mjs', // this file
    ],
  },
  ...compat.extends('eslint:recommended', 'plugin:prettier/recommended'),
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
    },
  },
  {
    files: ['**/*.js'],

    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  ...compat.extends('plugin:@typescript-eslint/recommended', 'plugin:n/recommended').map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],

    plugins: {
      '@typescript-eslint': typescriptEslint,
    },

    languageOptions: {
      parser: tsParser,
    },

    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      'n/no-missing-import': 'off',
      'n/no-process-exit': 'off',
      'n/shebang': 'off',
      'no-case-declarations': 'off',
      'no-empty': 'off',
      'no-ex-assign': 'off',
      'no-inner-declarations': 'off',
      'no-useless-catch': 'off',

      'prefer-const': [
        'error',
        {
          destructuring: 'all',
        },
      ],

      'prefer-rest-params': 'off',
      'prefer-spread': 'off',
    },
  },
];
