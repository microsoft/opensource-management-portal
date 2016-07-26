//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

// set environment vars required in bash profile for consistency
// need to encrypt keys and add cert for security

const painlessConfig = require('painless-config');
const pkgInfo = require('./package.json');
const utils = require('./utils');

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

const obfuscationSuffixCharactersToShow = 4;

module.exports = function translateEnvironmentToConfiguration(obfuscateSecrets) {
  var configurationHelper = painlessConfig;
  for (let i = 0; i < requiredConfigurationKeys.length; i++) {
    if (!configurationHelper.get(requiredConfigurationKeys[i])) {
      throw new Error(`Configuration parameter "${requiredConfigurationKeys[i]}" is required for this application to initialize.`);
    }
  }
  if (obfuscateSecrets === true) {
    var secretKeys = new Set(secretConfigurationKeys);
    var wildcards = [];
    for (var wi = 0; wi < secretConfigurationKeys.length; wi++) {
      var wik = secretConfigurationKeys[wi];
      if (wik.startsWith('*') && wik.endsWith('*')) {
        wildcards.push(wik.substr(1, wik.length - 2));
      }
    }
    configurationHelper = {
      get: function (key) {
        var value = painlessConfig.get(key);
        if (secretKeys.has(key) && value !== undefined) {
          value = utils.obfuscate(value, obfuscationSuffixCharactersToShow);
        } else {
          for (var p = 0; p < wildcards.length; p++) {
            if (key.includes(wildcards[p])) {
              value = utils.obfuscate(value, obfuscationSuffixCharactersToShow);
              break;
            }
          }
        }
        return value;
      }
    };
  } else if (obfuscateSecrets !== false && obfuscateSecrets !== undefined) {
    throw new Error(`Invalid first parameter value: ${obfuscateSecrets}`);
  }
  let config = {
    logging: {
      errors: configurationHelper.get('SITE_SKIP_ERRORS') === undefined,
      version: pkgInfo.version,
      showUsers: configurationHelper.get('SITE_SHOW_USERS') === 'show',
    },
    secretConfigurationKeys: secretConfigurationKeys,
    obfuscatedConfig: null,
    companyName: configurationHelper.get('COMPANY_NAME'),
    portalName: configurationHelper.get('PORTAL_NAME') || 'Open Source Portal for GitHub',
    serviceBanner: configurationHelper.get('SITE_SERVICE_BANNER'),
    websiteSku: configurationHelper.get('WEBSITE_SKU'),
    expectedSslCertificate: configurationHelper.get('EXPECTED_SSL_CERTIFICATE'),
    allowHttp: configurationHelper.get('DEBUG_ALLOW_HTTP'),
    showDebugFooter: (configurationHelper.get('DEBUG_SHOW_FOOTER') === true || configurationHelper.get('DEBUG_SHOW_FOOTER') === 'true'),
    corporate: {
      userProfilePrefix: configurationHelper.get('CORPORATE_PROFILE_PREFIX'),
      trainingResources: require('./resources.json'),
      portalAdministratorEmail: configurationHelper.get('PORTAL_ADMIN_EMAIL'),
    },
    // Friends are GitHub username(s) which have special
    // access for application use such as CLA tooling and
    // compliance/audit accounts. Supports comma-sep lists.
    friends: {
      cla: utils.arrayFromString(configurationHelper.get('FRIENDS_CLA')),
      employeeData: utils.arrayFromString(configurationHelper.get('FRIENDS_DATA')),
    },
    authentication: {
      encrypt: configurationHelper.get('AUTHENTICATION_ENCRYPT') === 'encrypt',
      key: configurationHelper.get('AUTHENTICATION_ENCRYPT_KEY'),
      keyId: configurationHelper.get('AUTHENTICATION_ENCRYPT_KEY_ID'),
      scheme: configurationHelper.get('AUTHENTICATION_SCHEME'),
    },
    github: {
      clientId: configurationHelper.get('GITHUB_CLIENT_ID'),
      clientSecret: configurationHelper.get('GITHUB_CLIENT_SECRET'),
      callbackUrl: configurationHelper.get('GITHUB_CALLBACK_URL'),
    },
    organizations: [],
    onboarding: [],
    express: {
      sessionSalt: configurationHelper.get('SESSION_SALT'),
    },
    activeDirectory: {
      clientId: configurationHelper.get('AAD_CLIENT_ID'),
      clientSecret: configurationHelper.get('AAD_CLIENT_SECRET'),
      tenantId: configurationHelper.get('AAD_TENANT_ID'),
      redirectUrl: configurationHelper.get('AAD_REDIRECT_URL'),
      issuer: configurationHelper.get('AAD_ISSUER'),
      allowTenantGuests: (configurationHelper.get('AAD_ALLOW_TENANT_GUESTS') && configurationHelper.get('AAD_ALLOW_TENANT_GUESTS') === 'allow'),
    },
    // AppInsights is a Microsoft Cloud product for gathering analytics and
    // other useful information about apps. This app uses the Node.js npm
    // module for app insights to gather information on server generation
    // times, while the client JavaScript wrapper for AppInsights is also
    // used for monitoring client browser attributes and information. If the
    // key is not supplied, the app continues functioning.
    applicationInsights: {
      instrumentationKey: configurationHelper.get('APPINSIGHTS_INSTRUMENTATION_KEY'),
    },
    // An Azure storage account is used as all data is stored in a
    // geo-replicated storage account in table store. This is simple
    // model vs a SQL Database instance, but requires doing joins
    // on the server.
    azureStorage: {
      account: configurationHelper.get('XSTORE_ACCOUNT'),
      key: configurationHelper.get('XSTORE_KEY'),
      prefix: configurationHelper.get('XSTORE_PREFIX'),
    },
    // Redis is used for shared session state across running site instances.
    // The Azure Redis offering includes a redundant option, but as the
    // session store is designed like a cache, the only outcome of lost
    // Redis data is that the user will need to sign in again.
    redis: {
      port: configurationHelper.get('REDIS_PORT') || (configurationHelper.get('REDIS_TLS_HOST') ? 6380 : 6379),
      host: configurationHelper.get('REDIS_HOST') || configurationHelper.get('REDIS_TLS_HOST'),
      key: configurationHelper.get('REDIS_KEY'),
      ttl: configurationHelper.get('REDIS_TTL') || (60 * 60 * 24 * 7 /* one week */),
      prefix: configurationHelper.get('REDIS_PREFIX'),
      tls: configurationHelper.get('REDIS_TLS_HOST'),
    },
  };
  for (let i = 1; configurationHelper.get('GITHUB_ORG' + i + '_NAME'); i++) {
    var prefix = 'GITHUB_ORG' + i + '_';
    var onboarding = configurationHelper.get(prefix + 'ONBOARDING');
    var org = {
      name: configurationHelper.get(prefix + 'NAME'),
      type: configurationHelper.get(prefix + 'TYPE') || 'private',
      ownerToken: configurationHelper.get(prefix + 'TOKEN'),
      notificationRepo: configurationHelper.get(prefix + 'NOTIFICATION_REPO'),
      teamAllMembers: configurationHelper.get(prefix + 'EVERYONE_TEAMID'),
      teamRepoApprovers: configurationHelper.get(prefix + 'REPO_APPROVERS_TEAMID'),//If not set then repos. get created in Git.
      hookSecrets: utils.arrayFromString(configurationHelper.get(prefix + 'HOOK_TOKENS')),
      teamAllRepos: configurationHelper.get(prefix + 'SECURITY_TEAMID'),
      teamAllRepoWriteId: configurationHelper.get(prefix + 'ALLREPOWRITE_TEAMID'),
      teamSudoers: configurationHelper.get(prefix + 'SUDOERS_TEAMID'),
      description: configurationHelper.get(prefix + 'DESCRIPTION'),
      licenses: configurationHelper.get(prefix + 'LICENSES') ? utils.arrayFromString(configurationHelper.get(prefix + 'LICENSES')) : null,
      priority: configurationHelper.get(prefix + 'PRIORITY') || 'primary', // This value for now should be a string, 'primary' (default) or 'secondary', used to have a secondary class of orgs on the site homepage
      locked: configurationHelper.get(prefix + 'LOCKED') || false, // If a string value is present, i.e. 'locked' or 'lock', then the org will not allow joining at this time. Not a long-term feature once org join approval workflow is supported.
      highlightedTeams: [],
      approvalTypes: configurationHelper.get(prefix + 'APPROVAL_TYPES') ? utils.arrayFromString(configurationHelper.get(prefix + 'APPROVAL_TYPES')) : null,
      approvalUrlRequired : configurationHelper.get(prefix + 'APPROVAL_URL_REQUIRED_FOR') ? utils.arrayFromString(configurationHelper.get(prefix + 'APPROVAL_URL_REQUIRED_FOR')) : null,
      approvalUrlFormat: configurationHelper.get(prefix + 'APPROVAL_URL_FORMAT'),
      exemptionDetailsRequired : configurationHelper.get(prefix + 'EXEMPTION_DETAILS_REQUIRED_FOR') ? utils.arrayFromString(configurationHelper.get(prefix + 'EXEMPTION_DETAILS_REQUIRED_FOR')) : null
    };
    // The first org can have a special team, a portal sudoers team, that get
    // sudo access to ALL managed organizations. If such a property is not
    // present, the org's sudoers team become portal maintainers, too.
    if (i === 1) {
      org.teamPortalSudoers = configurationHelper.get(prefix + 'PORTAL_SUDOERS_TEAMID') || configurationHelper.get(prefix + 'SUDOERS_TEAMID');
    }
    // Highlighted teams are those which should be shown above all other teams
    // in the 'join a team' user interface, designed for very large teams that
    // most org members should consider being members of.
    var highlightIds = utils.arrayFromString(configurationHelper.get(prefix + 'HIGHLIGHTED_TEAMS'));
    var highlightText = utils.arrayFromString(configurationHelper.get(prefix + 'HIGHLIGHTED_TEAMS_INFO'), ';');
    if (highlightIds.length === highlightText.length) {
      for (let j = 0; j < highlightIds.length; j++) {
        org.highlightedTeams.push({
          id: highlightIds[j],
          description: highlightText[j],
        });
      }
    } else {
      throw new Error('Invalid matching of size for highlighted teams.');
    }
    (onboarding ? config.onboarding : config.organizations).push(org);
  }
  return config;
};