//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log", "error", "warn", "dir"] }] */

'use strict';

import async = require('async');

import { IProviders, Application, InnerError, RedisOptions } from '../transitional';
import { createAndInitializeLinkProviderInstance } from '../lib/linkProviders';

import { DataClient } from '../data';

import { Operations } from '../business/operations';
import { ILinkProvider } from '../lib/linkProviders/postgres/postgresLinkProvider';
import { createAndInitializeEntityMetadataProviderInstance } from '../lib/entityMetadataProvider';
import { IEntityMetadataProvider } from '../lib/entityMetadataProvider/entityMetadataProvider';
import { createAndInitializeApprovalProviderInstance } from '../lib/approvalProvider';

const redis = require('redis');
const redisMock = require('redis-mock');
const debug = require('debug')('oss-initialize');
const DocumentDBClient = require('documentdb').DocumentClient;
const { Pool: PostgresPool } = require('pg');

const appInsights = require('./appInsights');
const keyVault = require('./keyVault');
const healthCheck = require('./healthCheck');

const RedisHelper = require('../lib/redis');
const graphProvider = require('../lib/graphProvider/');
const keyVaultResolver = require('../lib/keyVaultResolver');
const mailProvider = require('../lib/mailProvider/');
const mailAddressProvider = require('../lib/mailAddressProvider/');
const githubProvider = require('../lib/github');

async function initialize(app: Application, express, rootdir: string, config, earlyInitError: any): Promise<void> {
  const providers = app.get('providers') as IProviders;

  providers.linkProvider = await createAndInitializeLinkProviderInstance(providers, config);

  providers.mailProvider = await configureOptionalMailProvider(config);
  app.set('mailProvider', providers.mailProvider); // necessry anymore? hopefully not!

  const redisHelper = providers.redis;
  const dc = providers.dataClient;
  providers.github = await configureGitHubLibrary(app, redisHelper, dc, providers.linkProvider, config);
  app.set('github', providers.github);

  providers.entityMetadata = await createAndInitializeEntityMetadataProviderInstance(app, config, providers);
  providers.approvalProvider = await createAndInitializeApprovalProviderInstance(app, config, providers);
  try {
    providers.dataClient = await configureLegacyDataClient(app, config, providers);
  } catch (ignoreDataClientCreate) {
    console.dir(ignoreDataClientCreate);
  }

  try {
    if (!earlyInitError) {
      const operations = new Operations(providers);
      app.set('operations', operations);
      providers.operations = operations;
    }
  } catch (ignoredError2) {
    console.dir(ignoredError2);
  }

  debug('*');
}

async function configureGitHubLibrary(app, redis, dc, linkProvider: ILinkProvider, config): Promise<any> {
  return new Promise<any>((resolve, reject) => {
    const options = {
      config,
      redis,
      dataClient: dc,
      insights: app.get('appInsightsClient'),
      linkProvider,
    };
    const libraryContext = githubProvider(options);
    return resolve(libraryContext);
  });
}

async function configureLegacyDataClient(app, config, providers: IProviders): Promise<DataClient> {
  const keyEncryptionKeyResolver = providers.keyEncryptionKeyResolver;
  return new Promise((resolve, reject) => {
    const dataClientOptions = {
      config: config,
      keyEncryptionKeyResolver: keyEncryptionKeyResolver,
      providers: providers,
    };
    new DataClient(dataClientOptions, function (error, dcInstance: DataClient) {
      if (error) {
        return reject(error);
      }

      debug(`Azure Storage ready: ${dcInstance.options.partitionKey} ${dcInstance.options.linksTableName}`);
      app.set('dataclient', dcInstance);
      providers.dataClient = dcInstance;
      return resolve(dcInstance);
    });
});
}

async function configureOptionalMailProvider(config): Promise<any> {
  return new Promise<any>((resolve, reject) => {
    mailProvider(config, (providerInitError, provider) => {
      return providerInitError ? reject(providerInitError) : resolve(provider);
    });
  });
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
  if (configurationError) {
    return finalizeInitialization(configurationError);
  }

  const kvConfig = {
    clientId: config.activeDirectory.clientId,
    clientSecret: config.activeDirectory.clientSecret,
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
  if (!config.redis.host || !config.redis.tls) {
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
    if (!wr.host || !wr.tls) {
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
    function createMailAddressProvider(cb) {
      const options = {
        config: config,
        redisClient: redisClient,
        providers: providers,
      };
      mailAddressProvider(options, (providerInitError, provider) => {
        if (providerInitError) {
          return cb(providerInitError);
        }
        app.set('mailAddressProvider', provider);
        providers.mailAddressProvider = provider;
        cb();
      });
    },
    function initializePostgres(next) {
      try {
        if (config.data && config.data.postgres && config.data.postgres.user) {
          const pool = new PostgresPool(config.data.postgres);
          // central
          pool.on('error', (err, client) => {
            console.error('POSTGRES POOL ERROR:');
            console.dir(err);
            // ?
          });
          pool.on('connect', (client) => {
            debug(`Pool connecting a new client (pool: ${pool.totalCount} clients, ${pool.idleCount} idle, ${pool.waitingCount} waiting)`);
          });
          pool.on('acquire', client => {
            debug(`Postgres client being checked out (pool: ${pool.totalCount} clients, ${pool.idleCount} idle, ${pool.waitingCount} waiting)`);
          });
          pool.on('remove', client => {
            debug(`Postgres client checked back in (pool: ${pool.totalCount} clients, ${pool.idleCount} idle, ${pool.waitingCount} waiting)`);
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
    function initializeCosmosDB(next) {
      // This is a short-term implementation of using CosmosDB, but as a root
      // provider, this is messy. Should instead have specific providers that
      // use the resource as needed.
      if (config.github.cosmosdb && config.github.cosmosdb.key) {
        const cosmosConfig = config.github.cosmosdb;
        const temporaryDatabaseName =  cosmosConfig.database || 'opensource';
        const cosmosClient = new DocumentDBClient(cosmosConfig.uri, {
          masterKey: cosmosConfig.key,
        });
        cosmosClient.readDatabase(`dbs/${temporaryDatabaseName}`, function (readDatabaseError, database) {
          if (readDatabaseError) {
            return next(readDatabaseError);
          }
          debug(`connected to Cosmos DB: ${cosmosConfig.database} at ${cosmosConfig.uri}`);
          providers.cosmosdb = {
            client: cosmosClient,
            database: database,
            colNameTemp: cosmosConfig.collection,
          };
          return next();
        });
      } else {
        return next();
      }
    },
    function createGraphProvider(cb) {
      // The graph provider is optional. A graph provider can connect to a
      // corporate directory to validate or lookup employees and other
      // directory members at runtime to gather additional information.
      graphProvider(config, (providerInitError: Error, provider) => {
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
      finalizeInitialization(error);
    });
  });
};
