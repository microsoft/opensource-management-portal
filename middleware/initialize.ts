//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log", "error", "warn", "dir"] }] */

import CosmosSessionStore from '../lib/cosmosSession';

import { IProviders, IReposApplication, InnerError, RedisOptions } from '../transitional';
import { createAndInitializeLinkProviderInstance, ILinkProvider } from '../lib/linkProviders';

import { Operations } from '../business/operations';
import { createAndInitializeEntityMetadataProviderInstance, IEntityMetadataProvidersOptions } from '../lib/entityMetadataProvider';
import { createAndInitializeRepositoryMetadataProviderInstance } from '../entities/repositoryMetadata';

import { createMailAddressProviderInstance, IMailAddressProvider } from '../lib/mailAddressProvider';

import redis = require('redis');
import { Pool as PostgresPool } from 'pg';

const redisMock = require('redis-mock');
const debug = require('debug')('startup');
const pgDebug = require('debug')('pgpool');

const appInsights = require('./appInsights');
const keyVault = require('./keyVault');
const healthCheck = require('./healthCheck');

import expressRoutes from '../routes/';

import RedisHelper from '../lib/caching/redis';
import { createTokenProvider } from '../entities/token';
import { createAndInitializeApprovalProviderInstance } from '../entities/teamJoinApproval';
import { CreateLocalExtensionKeyProvider } from '../entities/localExtensionKey';
import { CreateGraphProviderInstance, IGraphProvider } from '../lib/graphProvider/';

const keyVaultResolver = require('../lib/keyVaultResolver');
import CreateMailProviderInstance from '../lib/mailProvider/';
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
import { createAndInitializeAuditLogRecordProviderInstance } from '../entities/auditLogRecord';
import { createAndInitializeEventRecordProviderInstance } from '../entities/events';
import CosmosCache from '../lib/caching/cosmosdb';
import BlobCache from '../lib/caching/blob';
import { StatefulCampaignProvider } from '../lib/campaigns';
import CosmosHelper from '../lib/cosmosHelper';
import createCorporateContactProviderInstance from '../lib/corporateContactProvider';
import { IQueueProcessor } from '../lib/queues';
import ServiceBusQueueProcessor from '../lib/queues/servicebus';
import AzureQueuesProcessor from '../lib/queues/azurequeue';

async function initializeAsync(app: IReposApplication, express, rootdir: string, config): Promise<void> {
  const providers = app.get('providers') as IProviders;
  providers.postgresPool = await connectPostgres(config);
  providers.linkProvider = await createAndInitializeLinkProviderInstance(providers, config);
  if (config.github.cache.provider === 'cosmosdb') {
    const cosmosCache = new CosmosCache(config.github.cache.cosmosdb);
    await cosmosCache.initialize();
    providers.cacheProvider = cosmosCache;
  } else if (config.github.cache.provider === 'blob') {
    const blobCache = new BlobCache(config.github.cache.blob);
    await blobCache.initialize();
    providers.cacheProvider = blobCache;
  } else if (config.github.cache.provider === 'redis') {
    const redisClient = await connectRedis(config, config.redis, 'cache');
    const redisHelper = new RedisHelper({redisClient, prefix: config.redis.prefix});
    // providers.redisClient = redisClient;
    providers.cacheProvider = redisHelper;
  } else {
    throw new Error('No cache provider available');
  }

  providers.witnessRedis = await witnessRedisConnect(config);
  if (providers.witnessRedis) {
    providers.witnessRedisHelper = new RedisHelper({
      redisClient: providers.witnessRedis,
      prefix: config.redis.prefix,
    });  
  }

  providers.graphProvider = await createGraphProvider(config);
  app.set('graphProvider', providers.graphProvider);

  providers.mailAddressProvider = await createMailAddressProvider(config, providers);
  app.set('mailAddressProvider', providers.mailAddressProvider);

  providers.mailProvider = CreateMailProviderInstance(config);
  app.set('mailProvider', providers.mailProvider); // necessry anymore? hopefully not!

  providers.github = await configureGitHubLibrary(app, providers.cacheProvider, providers.linkProvider, config);
  app.set('github', providers.github);

  // always check if config exists to prevent crashing because of trying to access an undefined object
  const emOptions: IEntityMetadataProvidersOptions = {
    tableOptions: {
      account: config.github?.links?.table?.account,
      key: config.github?.links?.table?.key,
      prefix: config.github?.links?.table?.prefix,
      encryption: {
        keyEncryptionKeyId: config.github?.links?.table?.encryptionKeyId,
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
  const defaultProvider = pgEntityMetadataProvider || tableEntityMetadataProvider || memoryEntityMetadataProvider;
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
  providers.auditLogRecordProvider = await createAndInitializeAuditLogRecordProviderInstance({ entityMetadataProvider: providerNameToInstance(config.entityProviders.auditlogrecord )});
  providers.eventRecordProvider = await createAndInitializeEventRecordProviderInstance({ entityMetadataProvider: providerNameToInstance(config.entityProviders.eventrecord )});
  providers.queryCache = new QueryCache(providers);
  if (config.campaigns && config.campaigns.provider === 'cosmosdb') {
    const campaignCosmosStore = new CosmosHelper({
      endpoint: config.campaigns.cosmosdb.endpoint,
      key: config.campaigns.cosmosdb.key,
      database: config.campaigns.cosmosdb.database,
      collection: config.campaigns.cosmosdb.collection,
    });
    await campaignCosmosStore.initialize();
    providers.campaignStateProvider = new StatefulCampaignProvider(campaignCosmosStore);
  }
  if (config.session.provider === 'cosmosdb') {
    const cosmosStore = new CosmosSessionStore({
      endpoint: config.session.cosmosdb.endpoint,
      key: config.session.cosmosdb.key,
      database: config.session.cosmosdb.database,
      collection: config.session.cosmosdb.collection,
      ttl: config.session.cosmosdb.ttl,
    });
    await cosmosStore.initialize();
    providers.session = cosmosStore;
  } else if (config.session.provider === 'redis') {
    const redisSessionClient = await connectRedis(config, config.session.redis, 'session');
    providers.sessionRedisClient = redisSessionClient;
  }

  providers.corporateContactProvider = createCorporateContactProviderInstance(config, providers.cacheProvider);

  const webhooksConfig = config.github.webhooks;
  if (webhooksConfig && webhooksConfig.provider) {
    let webhooksProvider: IQueueProcessor = null;
    if (webhooksConfig.provider === 'servicebus') {
      const serviceBusConfig = webhooksConfig.serviceBus;
      webhooksProvider = new ServiceBusQueueProcessor(serviceBusConfig);
    } else if (webhooksConfig.provider === 'azurequeues') {
      const queuesConfig = webhooksConfig.azureQueues;
      webhooksProvider = new AzureQueuesProcessor(queuesConfig);
    }
    if (webhooksProvider) {
      await webhooksProvider.initialize();
      providers.webhookQueueProcessor = webhooksProvider;
    }
  }

  try {
    const operations = await (new Operations(providers)).initialize();
    app.set('operations', operations);
    providers.operations = operations;
  } catch (ignoredError2) {
    console.dir(ignoredError2);
    throw ignoredError2;
  }
  debug('Good to go.');
}

function configureGitHubLibrary(app, redis, linkProvider: ILinkProvider, config): RestLibrary {
  if (config && config.github && config.github.operations && !config.github.operations.centralOperationsToken) {
    debug('WARNING: no central GitHub operations token is defined, some library operations may not succeed. ref: config.github.operations.centralOperationsToken var: GITHUB_CENTRAL_OPERATIONS_TOKEN');
  }
  const libraryContext = new RestLibrary({
    config,
    redis,
    insights: app.get('appInsightsClient'),
    linkProvider,
  });
  return libraryContext;
}

// Asynchronous initialization for the Express app, configuration and data stores.
export default function initialize(app: IReposApplication, express, rootdir: string, config, configurationError, callback) {
  app.set('started', new Date());
  if (configurationError) {
    // Once app insights is available, will try to log this exception; display for now.
    console.dir(configurationError);
  }
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
    // providers.redisClient = redisClient;
    try {
      require('./index')(app, express, config, rootdir, redisClient, error);
    } catch (middlewareError) {
      error = middlewareError;
    }
    if (!error) {
      app.use('/', expressRoutes);
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
  initializeAsync(app, express, rootdir, config).then(success => {
    finalizeInitialization();
  }, (failure: Error) => {
    console.dir(failure);
    debug(`Initialization failure: ${failure.message}`);
    finalizeInitialization(failure);
  });
};

function createGraphProvider(config: any): Promise<IGraphProvider> {
  return new Promise((resolve, reject) => {
    // The graph provider is optional. A graph provider can connect to a
    // corporate directory to validate or lookup employees and other
    // directory members at runtime to gather additional information.
    CreateGraphProviderInstance(config, (providerInitError: Error, provider: IGraphProvider) => {
      if (providerInitError) {
        debug(`No org chart graph provider configured: ${providerInitError.message}`);
        // NOTE: never rejects
      } else {
        return resolve(provider);
      }
      return resolve();
    });  
  });
}

function connectPostgres(config: any): Promise<PostgresPool> {
  return new Promise((resolve, reject) => {
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
            return reject(poolError);
          }
          client.query('SELECT NOW()', (err, result) => {
            release();
            if (err) {
              const poolQueryError : InnerError = new Error('There was a problem performing a test query to the Postgres server');
              poolQueryError.inner = err;
              return reject(poolQueryError);
            }
            debug(`connected to Postgres (${config.data.postgres.host} ${config.data.postgres.database} as ${config.data.postgres.user}) and a pool of ${config.data.postgres.max} clients is available in providers.postgresPool`);
            return resolve(pool);
          })
        })
      } else {
        return resolve();
      }
    } catch (failProblem) {
      return reject(failProblem);
    }
  });
}

function connectRedis(config: any, redisConfig: any, purpose: string): Promise<redis.RedisClient> {
  const nodeEnvironment = config && config.node ? config.node.environment : null;
  let redisClient: redis.RedisClient = null;
  const redisOptions: RedisOptions = {
  auth_pass: redisConfig.key,
  detect_buffers: true,
  };
  if (redisConfig.tls) {
    redisOptions.tls = {
      servername: redisConfig.tls,
    };
  }
  if (!redisConfig.host && !redisConfig.tls) {
    if (nodeEnvironment === 'production') {
      console.warn(`${purpose}: Redis host or TLS host must be provided in production environments`);
      throw new Error(`No ${purpose}.redis.host or ${purpose}.redis.tls`);
    }
    debug(`mocking Redis, in-memory provider in use`);
    redisClient = redisMock.createClient();
  } else {
    debug(`connecting to ${purpose} Redis ${redisConfig.host || redisConfig.tls}`);
    const port = redisConfig.port || (redisConfig.tls ? 6380 : 6379);
    redisClient = redis.createClient(port, redisConfig.host || redisConfig.tls, redisOptions);
  }
  let isFirst = true;
  return new Promise((resolve, reject) => {
    redisClient.on('connect', function () {
      if (isFirst) {
        isFirst = false;
        return resolve(redisClient);
      }
    });
    // NOTE: a timeout would hang the process here
    redisClient.auth(config.redis.key);
    debug(`authenticated to Redis for ${purpose}`);
  });
}

function witnessRedisConnect(config: any): Promise<redis.RedisClient> {
  if (!config.witness || !config.witness.redis) {
    return Promise.resolve(null);
  }
  const nodeEnvironment = config && config.node ? config.node.environment : null;
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
  wr.port = wr.port || (wr.tls ? 6380 : 6379);
  if (!wr.host && !wr.tls) {
    if (nodeEnvironment === 'production') {
      console.warn('Redis host or TLS host must be provided in production environments');
      throw new Error('No wr.host or wr.tls');
    }
    debug(`mocking Witness Redis, in-memory provider in use`);
    return Promise.resolve(redisMock.createClient());
  } else {
    debug(`connecting to Witness Redis ${wr.host || wr.tls}`);
    return Promise.resolve(redis.createClient(wr.port, wr.host || wr.tls, witnessRedisOptions));
  }
}

function createMailAddressProvider(config: any, providers: IProviders): Promise<IMailAddressProvider> {
  const options = {
    config: config,
    providers: providers,
  };
  return new Promise((resolve, reject) => {
    createMailAddressProviderInstance(options, (providerInitError, provider: IMailAddressProvider) => {
      if (providerInitError) {
        return reject(providerInitError);
      }
      return resolve(provider);
    });  
  });
}
