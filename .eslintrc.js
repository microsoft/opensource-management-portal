module.exports = {
  root: true,
  extends: ['eslint:recommended', 'plugin:prettier/recommended'],
  overrides: [
    {
      files: ['**/*.js'],
      env: {
        es6: true,
        node: true,
      },
    },
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      extends: ['plugin:@typescript-eslint/recommended', 'plugin:n/recommended'],
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
  ],
  ignorePatterns: ['default-assets-package/thirdparty/**/*.js', 'dist/**/*.js', '**/vendor/**'],
};
