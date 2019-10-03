//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log", "error", "warn", "dir"] }] */

'use strict';

import async = require('async');

import { IProviders, Application, InnerError, RedisOptions } from '../transitional';
import { createAndInitializeLinkProviderInstance } from '../lib/linkProviders';

import { Operations } from '../business/operations';
import { ILinkProvider } from '../lib/linkProviders/postgres/postgresLinkProvider';
import { createAndInitializeEntityMetadataProviderInstance, IEntityMetadataProvidersOptions } from '../lib/entityMetadataProvider';
import { createAndInitializeRepositoryMetadataProviderInstance } from '../entities/repositoryMetadata';

import { createMailAddressProviderInstance, IMailAddressProvider } from '../lib/mailAddressProvider';

import redis = require('redis');
import { Pool as PostgresPool } from 'pg';

const redisMock = require('redis-mock');
const debug = require('debug')('oss-initialize');
const pgDebug = require('debug')('pgpool');

const appInsights = require('./appInsights');
const keyVault = require('./keyVault');
const healthCheck = require('./healthCheck');

import { RedisHelper } from '../lib/redis';
import { createTokenProvider } from '../entities/token';
import { createAndInitializeApprovalProviderInstance } from '../entities/teamJoinApproval';
import { CreateLocalExtensionKeyProvider } from '../entities/localExtensionKey';
import { CreateGraphProviderInstance, IGraphProvider } from '../lib/graphProvider/';

const keyVaultResolver = require('../lib/keyVaultResolver');
import CreateMailProviderInstance, { IMailProvider } from '../lib/mailProvider/';
import { RestLibrary } from '../lib/github';
import { CreateRepositoryCacheProviderInstance } from '../entities/repositoryCache';
import { CreateRepositoryCollaboratorCacheProviderInstance } from '../entities/repositoryCollaboratorCache';
import { CreateTeamCacheProviderInstance } from '../entities/teamCache';
import { CreateTeamMemberCacheProviderInstance } from '../entities/teamMemberCache';
import { CreateRepositoryTeamCacheProviderInstance } from '../entities/repositoryTeamCache';
import { CreateOrganizationMemberCacheProviderInstance } from '../entities/organizationMemberCache';
import QueryCache from '../business/queryCache';
import { createAndInitializeOrganizationSettingProviderInstance } from '../entities/organizationSettings';
import { IEntityMetadataProvider } from '../lib/entityMetadataProvider/entityMetadataProvider';

async function initialize(app: Application, express, rootdir: string, config, earlyInitError: any): Promise<void> {
  const providers = app.get('providers') as IProviders;

  providers.linkProvider = await createAndInitializeLinkProviderInstance(providers, config);

  providers.mailProvider = CreateMailProviderInstance(config);
  app.set('mailProvider', providers.mailProvider); // necessry anymore? hopefully not!

  const redisHelper = providers.redis;
  providers.github = await configureGitHubLibrary(app, redisHelper, providers.linkProvider, config);
  app.set('github', providers.github);

  const emOptions: IEntityMetadataProvidersOptions = {
    tableOptions: {
      account: config.github.links.table.account,
      key: config.github.links.table.key,
      prefix: config.github.links.table.prefix,
      encryption: {
        keyEncryptionKeyId: config.github.links.table.encryptionKeyId,
        keyResolver: providers.keyEncryptionKeyResolver,
      },
    },
    postgresOptions: {
      pool: providers.postgresPool,
    },
  };
  let tableProviderEnabled = emOptions.tableOptions && emOptions.tableOptions.account && emOptions.tableOptions.key;
  let postgresProviderEnabled = emOptions.postgresOptions && emOptions.postgresOptions.pool;
  const tableEntityMetadataProvider = tableProviderEnabled ? await createAndInitializeEntityMetadataProviderInstance(
    app,
    config,
    emOptions,
    'table') : null;
  const pgEntityMetadataProvider = postgresProviderEnabled ? await createAndInitializeEntityMetadataProviderInstance(
    app,
    config,
    emOptions,
    'postgres') : null;
  const memoryEntityMetadataProvider = await createAndInitializeEntityMetadataProviderInstance(
      app,
      config,
      emOptions,
      'memory');
  const defaultProvider = memoryEntityMetadataProvider || pgEntityMetadataProvider || tableEntityMetadataProvider;
  function providerNameToInstance(value: string): IEntityMetadataProvider {
    switch (value) {
      case 'firstconfigured':
        return defaultProvider;
      case 'postgres':
        return pgEntityMetadataProvider;
      case 'table':
        return tableEntityMetadataProvider;
      case 'memory':
        return memoryEntityMetadataProvider;
      default:
        return null;
    }
  }
  // providers.entityMetadata = await createAndInitializeEntityMetadataProviderInstance(app, config, providers);
  providers.approvalProvider = await createAndInitializeApprovalProviderInstance({ entityMetadataProvider: providerNameToInstance(config.entityProviders.teamjoin) });
  providers.repositoryMetadataProvider = await createAndInitializeRepositoryMetadataProviderInstance({ entityMetadataProvider: providerNameToInstance(config.entityProviders.repositorymetadata) });
  providers.tokenProvider = await createTokenProvider({ entityMetadataProvider: providerNameToInstance(config.entityProviders.tokens) });
  providers.localExtensionKeyProvider = await CreateLocalExtensionKeyProvider({ entityMetadataProvider: providerNameToInstance(config.entityProviders.localextensionkey) });
  providers.organizationMemberCacheProvider = await CreateOrganizationMemberCacheProviderInstance({ entityMetadataProvider: providerNameToInstance(config.entityProviders.organizationmembercache) });
  providers.organizationSettingsProvider = await createAndInitializeOrganizationSettingProviderInstance({ entityMetadataProvider: providerNameToInstance(config.entityProviders.organizationsettings) });
  providers.repositoryCacheProvider = await CreateRepositoryCacheProviderInstance({ entityMetadataProvider: providerNameToInstance(config.entityProviders.repositorycache) });
  providers.repositoryCollaboratorCacheProvider = await CreateRepositoryCollaboratorCacheProviderInstance({ entityMetadataProvider: providerNameToInstance(config.entityProviders.repositorycollaboratorcache) });
  providers.repositoryTeamCacheProvider = await CreateRepositoryTeamCacheProviderInstance({ entityMetadataProvider: providerNameToInstance(config.entityProviders.repositoryteamcache) });
  providers.teamCacheProvider = await CreateTeamCacheProviderInstance({ entityMetadataProvider: providerNameToInstance(config.entityProviders.teamcache) });
  providers.teamMemberCacheProvider = await CreateTeamMemberCacheProviderInstance({ entityMetadataProvider: providerNameToInstance(config.entityProviders.teammembercache) });
  providers.queryCache = new QueryCache(providers);
  try {
    if (!earlyInitError) {
      const operations = await (new Operations(providers)).initialize();
      app.set('operations', operations);
      providers.operations = operations;
    }
  } catch (ignoredError2) {
    console.dir(ignoredError2);
    throw ignoredError2;
  }
  debug('*');
}

function configureGitHubLibrary(app, redis, linkProvider: ILinkProvider, config): RestLibrary {
  const libraryContext = new RestLibrary({
    config,
    redis,
    insights: app.get('appInsightsClient'),
    linkProvider,
  });
  return libraryContext;
}

// Asynchronous initialization for the Express app, configuration and data stores.
module.exports = function init(app: Application, express, rootdir, config, configurationError, callback) {
  app.set('started', new Date());
  if (configurationError) {
    // Once app insights is available, will try to log this exception; display for now.
    console.dir(configurationError);
  }
  const nodeEnvironment = config && config.node ? config.node.environment : null;
  app.set('basedir', rootdir);
  var providers: IProviders = {
    basedir: rootdir,
  };
  app.set('providers', providers);
  app.set('runtimeConfig', config);
  providers.healthCheck = healthCheck(app, config);
  app.use(require('./correlationId'));
  providers.insights = appInsights(app, config);
  app.set('appInsightsClient', providers.insights);

  let redisClient = null;
  let finalizeInitialization = (error?) => {
    providers.redisClient = redisClient;
    try {
      require('./index')(app, express, config, rootdir, redisClient, error);
    } catch (middlewareError) {
      error = middlewareError;
    }
    if (!error) {
      app.use('/', require('../routes/'));
    } else {
      console.error(error);
      const appInsightsClient = providers.insights;
      const crash = (error) => {
        return () => {
          debug('App crashed because of an initialization error.');
          console.log(error.message);
          if (error.stack) {
            console.log(error.stack);
          }
          process.exit(1);
        };
      };
      if (appInsightsClient) {
        appInsightsClient.trackException({
          exception: error,
          properties: {
            info: 'App crashed while initializing',
          },
        });
        try {
          appInsightsClient.flush({ isAppCrashing: true, callback: crash(error) });
        } catch (sendError) {
          console.dir(sendError);
          crash(error)();
        }
      } else {
        crash(error)();
      }
    }
    require('./error-routes')(app, error);
    callback(null, app);
  };
  if (!configurationError && (!config || !config.activeDirectory)) {
    configurationError = `config.activeDirectory.clientId and config.activeDirectory.clientSecret are required to initialize KeyVault`;
  }
  if (configurationError) {
    return finalizeInitialization(configurationError);
  }
  const kvConfig = {
    clientId: config && config.activeDirectory ? config.activeDirectory.clientId : null,
    clientSecret: config && config.activeDirectory ? config.activeDirectory.clientSecret : null,
  };
  providers.config = config;
  let keyEncryptionKeyResolver = null;
  try {
    const keyVaultClient = keyVault(kvConfig);
    keyEncryptionKeyResolver = keyVaultResolver(keyVaultClient);
    app.set('keyEncryptionKeyResolver', keyEncryptionKeyResolver);
    providers.keyEncryptionKeyResolver = keyEncryptionKeyResolver;
    debug('configuration secrets resolved');
  } catch (noKeyVault) {
    debug('configuration resolved');
  }
  var redisFirstCallback;
  var redisOptions : RedisOptions = {
    auth_pass: config.redis.key,
    detect_buffers: true,
  };
  if (config.redis.tls) {
    redisOptions.tls = {
      servername: config.redis.tls,
    };
  }
  if (!config.redis.host && !config.redis.tls) {
    if (nodeEnvironment === 'production') {
      console.warn('Redis host or TLS host must be provided in production environments');
      throw new Error('No config.redis.host or config.redis.tls');
    }
    debug(`mocking Redis, in-memory provider in use`);
    redisClient = redisMock.createClient();
  } else {
    debug(`connecting to Redis ${config.redis.host || config.redis.tls}`);
    const port = config.redis.port || (config.redis.tls ? 6380 : 6379);
    redisClient = redis.createClient(port, config.redis.host || config.redis.tls, redisOptions);
  }
  const redisHelper = new RedisHelper(redisClient, config.redis.prefix);
  app.set('redisHelper', redisHelper);
  providers.redis = redisHelper;
  redisClient.on('connect', function () {
    if (redisFirstCallback) {
      var cb = redisFirstCallback;
      redisFirstCallback = null;
      cb();
    }
  });

  // 9/12/17: removing opt-in, making witness redis only dependent on having the configuration
  if (/*config.optInModules && config.optInModules.has('witnessRedis') && */config.witness && config.witness.redis) {
    const wr = config.witness.redis;
    const witnessRedisOptions : RedisOptions = {
      auth_pass: wr.key,
      detect_buffers: true,
    };
    if (wr.tls) {
      witnessRedisOptions.tls = {
        servername: wr.tls,
      };
    }
    wr.port = wr.port || wr.tls ? 6380 : 6379;
    if (!wr.host && !wr.tls) {
      if (nodeEnvironment === 'production') {
        console.warn('Redis host or TLS host must be provided in production environments');
        throw new Error('No wr.host or wr.tls');
      }
      debug(`mocking Witness Redis, in-memory provider in use`);
      providers.witnessRedis = redisMock.createClient();
    } else {
      debug(`connecting to Witness Redis ${wr.host || wr.tls}`);
      providers.witnessRedis = redis.createClient(wr.port, wr.host || wr.tls, witnessRedisOptions);
    }
    providers.witnessRedisHelper = new RedisHelper(providers.witnessRedis);
  }

  async.parallel([
    function (cb) {
      redisFirstCallback = cb;
      redisClient.auth(config.redis.key);
      debug('authenticated to Redis');
    },
    function createMailAddressProvider(next) {
      const options = {
        config: config,
        redisClient: redisClient,
        providers: providers,
      };
      createMailAddressProviderInstance(options, (providerInitError, provider: IMailAddressProvider) => {
        if (providerInitError) {
          return next(providerInitError);
        }
        app.set('mailAddressProvider', provider);
        providers.mailAddressProvider = provider;
        return next();
      });
    },
    function initializePostgres(next) {
      try {
        if (config.data && config.data.postgres && config.data.postgres.user) {
          const pool = new PostgresPool(config.data.postgres);
          // central
          pool.on('error', (err, client) => {
            pgDebug('POSTGRES POOL ERROR:');
            pgDebug(err);
          });
          pool.on('connect', (client) => {
            pgDebug(`Pool connecting a new client (pool: ${pool.totalCount} clients, ${pool.idleCount} idle, ${pool.waitingCount} waiting)`);
          });
          pool.on('acquire', client => {
            pgDebug(`Postgres client being checked out (pool: ${pool.totalCount} clients, ${pool.idleCount} idle, ${pool.waitingCount} waiting)`);
          });
          pool.on('remove', client => {
            pgDebug(`Postgres client checked back in (pool: ${pool.totalCount} clients, ${pool.idleCount} idle, ${pool.waitingCount} waiting)`);
          });
          // try connecting
          pool.connect((err, client, release) => {
            if (err) {
              const poolError : InnerError = new Error(`There was a problem connecting to the Postgres server`);
              poolError.inner = err;
              return next(poolError);
            }
            client.query('SELECT NOW()', (err, result) => {
              release();
              if (err) {
                const poolQueryError : InnerError = new Error('There was a problem performing a test query to the Postgres server');
                poolQueryError.inner = err;
                return next(poolQueryError);
              }
              debug(`connected to Postgres (${config.data.postgres.host} ${config.data.postgres.database} as ${config.data.postgres.user}) and a pool of ${config.data.postgres.max} clients is available in providers.postgresPool`);
              providers.postgresPool = pool;
              return next();
            })
          })
        } else {
          return next();
        }
      } catch (failProblem) {
        return next(failProblem);
      }
    },
    function createGraphProvider(cb) {
      // The graph provider is optional. A graph provider can connect to a
      // corporate directory to validate or lookup employees and other
      // directory members at runtime to gather additional information.
      CreateGraphProviderInstance(config, (providerInitError: Error, provider: IGraphProvider) => {
        if (providerInitError) {
          debug(`No org chart graph provider configured: ${providerInitError.message}`);
        } else {
          app.set('graphProvider', provider);
          providers.graphProvider = provider;
        }
        return cb();
      });
    },
  ], function (error) {
    // Async init:
    initialize(app, express, rootdir, config, error).then(success => {
      finalizeInitialization();
    }, (failure: Error) => {
      console.dir(failure);
      debug(`Initialization failure: ${failure.message}`);
      finalizeInitialization(error || failure);
    });
  });
};
