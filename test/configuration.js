//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const assert = require('chai').assert;

// these constants are defined inside the configuration.js file

const requiredConfigurationKeys = [
  'COMPANY_NAME',
  'CORPORATE_PROFILE_PREFIX',
  'PORTAL_ADMIN_EMAIL',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_CALLBACK_URL',
  'SESSION_SALT',
  'AAD_CLIENT_ID',
  'AAD_CLIENT_SECRET',
  'AAD_TENANT_ID',
  'AAD_ISSUER',
  'AAD_REDIRECT_URL',
  'XSTORE_ACCOUNT',
  'XSTORE_KEY',
  'REDIS_KEY',
];

const secretConfigurationKeys = [
  'GITHUB_CLIENT_SECRET',
  'SESSION_SALT',
  'AAD_CLIENT_SECRET',
  'XSTORE_KEY',
  'REDIS_KEY',
  '*TOKEN*', // Special case: covers auth tokens, hook tokens, etc.
];

// end of borrowed section

function wrappingConfigurationHelper(env) {
  return {
    get: function (key) {
      return env[key];
    }
  };
}

function createBareMinimumConfiguration() {
  const env = {};
  const secretSet = new Set(secretConfigurationKeys);
  for (const index in requiredConfigurationKeys) {
    const key = requiredConfigurationKeys[index];
    env[key] = secretSet.has(key) ? 'super secret' : 'just a value';
  }
  return wrappingConfigurationHelper(env);
}

function initializeConfiguration(env, scrub) {
  if (scrub === undefined) {
    scrub = false;
  }
  const config = require('../configuration')(scrub, env);
  return config;
}

function createBareConfigurationWithScrub() {
  const env = createBareMinimumConfiguration();
  const config = initializeConfiguration(env, false);
  const obfuscatedConfig = initializeConfiguration(env, true);
  config.obfuscatedConfig = obfuscatedConfig;
  return config;
}

describe('configuration', () => {
  describe('configuration object', () => {
    it('initializes some test data', () => {
      const testEnv = createBareMinimumConfiguration();
      const configResult = require('../configuration')(false, testEnv);
      assert.isDefined(configResult.logging, 'logging object exists');
    });
    it('successfully scrubs secret keys', () => {
      const configResult = createBareConfigurationWithScrub();
      assert.isDefined(configResult.obfuscatedConfig, 'obfuscated config exists');
      assert.notEqual(configResult.obfuscatedConfig.express.sessionSalt, 'super secret', 'session salt is hidden');
      assert.notEqual(configResult.obfuscatedConfig.express.sessionSalt, '***', 'session salt is obfuscated');
    });
  });
});



  /*describe('logger', () => {
    it('default does not share user identifier', () => {
          //assert.deepEqual(entity, roundtripEntity, 'roundtripEntity is equal to entity');
    }),
  });*/

