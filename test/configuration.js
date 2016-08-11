//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const assert = require('chai').assert;
const keyVaultHelper = require('../lib/keyVaultHelper');
const fakeKeyVaultClient = require('./fakeKeyVaultClient');

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

function createFakeWithKeys() {
  const faker = fakeKeyVaultClient();
  const secretId = faker.storeSecret('test', 'big secret', {
    tag1: 'p1',
    tag2: 'and tag 2',
  });
  return [faker, secretId];
}

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
  env['CONFIGURATION_ENVIRONMENT'] = 'test';
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
  describe('config', () => {
    it('initializes some test data', () => {
      const testEnv = createBareMinimumConfiguration();
      const configResult = require('../configuration')(false, testEnv);
      assert.isDefined(configResult.logging, 'logging object exists');
    });
    it('successfully scrubs secret keys', () => {
      const configResult = createBareConfigurationWithScrub();
      assert.isDefined(configResult.obfuscatedConfig, 'obfuscated config exists');
      assert.notEqual(configResult.obfuscatedConfig.session.salt, 'super secret', 'session salt is hidden');
      assert.notEqual(configResult.obfuscatedConfig.session.salt, '***', 'session salt is obfuscated');
    });
  });

  describe('organizations file', () => {
    it('the proper environment is selected', () => {
      const testEnv = createBareMinimumConfiguration();
      const configResult = require('../configuration')(false, testEnv);
      let pass = false;
      for (let i = 0; i < configResult.organizations.length; i++) {
        const org = configResult.organizations[i];
        if (org.name === 'test-org-1') {
          pass = true;
        }
      }
      assert.isTrue(pass, 'the test org is present');
    });
    it('data is set', () => {
      const testEnv = createBareMinimumConfiguration();
      const configResult = require('../configuration')(false, testEnv);
      let pass = false;
      for (let i = 0; i < configResult.organizations.length; i++) {
        const org = configResult.organizations[i];
        if (org.name === 'test-org-1') {
          assert.equal(org.token, '12345', 'token present');
          pass = true;
        }
      }
      assert.isTrue(pass, 'found the test org');
    });
  });


  describe('keyVaultHelper', () => {
    it('non-URL values passthrough', () => {
      const fake = createFakeWithKeys(); // es6 destructuring would be nice
      const keyVaultClient = fake[0];
      const config = {
        a: 'animal',
        b: 'bat',
        c: 'cherry',
        d: true,
        e: 5,
      };
      keyVaultHelper.resolveKeyVaultConfiguration(keyVaultClient, config, (error) => {
        assert.isNull(error, 'no exception');
        assert.equal(config.a, 'animal', 'string works');
        assert.equal(config.b, 'bat', 'string works');
        assert.equal(config.c, 'cherry', 'string works');
        assert.isTrue(config.d, 'bool works');
        assert.equal(config.e, 5, 'number is unaffected');
      });
    });
    it('keyvault:// protocol works', () => {
      const fake = createFakeWithKeys(); // es6 destructuring would be nice
      const keyVaultClient = fake[0];
      const secretId = fake[1];
      const keyVaultSchemeSecretId = secretId.replace('https://', 'keyvault://');
      const config = {
        bigPasscode: keyVaultSchemeSecretId,
      };
      keyVaultHelper.resolveKeyVaultConfiguration(keyVaultClient, config, () => {
        assert.equal(config.bigPasscode, 'big secret', 'secret read OK');
      });
    });
    it('deeply nested KeyVault URLs work', () => {
      const fake = createFakeWithKeys(); // es6 destructuring would be nice
      const keyVaultClient = fake[0];
      const secretId = fake[1];
      const keyVaultSchemeSecretId = secretId.replace('https://', 'keyvault://');
      const config = {
        deep: {
          object: {
            nesting: {
              test: {
                value: {
                  is: keyVaultSchemeSecretId,
                }
              }
            }
          }
        }
      };
      keyVaultHelper.resolveKeyVaultConfiguration(keyVaultClient, config, () => {
        assert.equal(config.deep.object.nesting.test.value.is, 'big secret', 'secret read OK');
      });
    });
    it('keyvault:// tag properties work', () => {
      const fake = createFakeWithKeys(); // es6 destructuring would be nice
      const keyVaultClient = fake[0];
      const secretId = fake[1];
      const keyVaultSchemeSecretId = secretId.replace('https://', 'keyvault://');
      const keyVaultSchemeSecretIdWithTag = secretId.replace('https://', 'keyvault://tag1@');
      const config = {
        taggedProperty: keyVaultSchemeSecretIdWithTag,
        kvProperty: keyVaultSchemeSecretId,
      };
      keyVaultHelper.resolveKeyVaultConfiguration(keyVaultClient, config, () => {
        assert.equal(config.kvProperty, 'big secret', 'secret read OK');
        assert.equal(config.taggedProperty, 'p1', 'tag read OK');
      });
    });
    it('keyvault:// tag properties return undefined if missing', () => {
      const fake = createFakeWithKeys(); // es6 destructuring would be nice
      const keyVaultClient = fake[0];
      const secretId = fake[1];
      const keyVaultSchemeSecretIdWithTag = secretId.replace('https://', 'keyvault://undefinedtagthing@');
      const config = {
        taggedProperty: keyVaultSchemeSecretIdWithTag,
      };
      keyVaultHelper.resolveKeyVaultConfiguration(keyVaultClient, config, () => {
        assert.isUndefined(config.taggedProperty, '=== undefined');
      });
    });
    it('URL values passthrough', () => {
      const fake = createFakeWithKeys(); // es6 destructuring would be nice
      const keyVaultClient = fake[0];
      const secretId = fake[1];
      const config = {
        a: secretId,
      };
      keyVaultHelper.resolveKeyVaultConfiguration(keyVaultClient, config, (error) => {
        assert.isNull(error, 'no exception');
        assert.equal(config.a, secretId, 'KeyVault URL is passed through');
      });
    });
    it('keyvault:// on an invalid secret stops processing', () => {
      const fake = createFakeWithKeys(); // es6 destructuring would be nice
      const keyVaultClient = fake[0];
      const config = {
        a: 'keyvault://invalid/secrets/hello/1',
      };
      keyVaultHelper.resolveKeyVaultConfiguration(keyVaultClient, config, (error) => {
        assert.isNotNull(error, 'exception thrown due to KeyVault client error');
      });
    });
  });
});
