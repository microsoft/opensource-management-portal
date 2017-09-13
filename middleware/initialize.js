//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["log", "error", "warn", "dir"] }] */

'use strict';

const async = require('async');
const appInsights = require('./appInsights');
const DataClient = require('../data');
const debug = require('debug')('oss-initialize');
const keyVault = require('./keyVault');
const healthCheck = require('./healthCheck');
const redis = require('redis');
const RedisHelper = require('../lib/redis');
const sql = require('mssql');
const graphProvider = require('../lib/graphProvider/');
const keyVaultResolver = require('../lib/keyVaultResolver');
const mailProvider = require('../lib/mailProvider/');
const mailAddressProvider = require('../lib/mailAddressProvider/');
const githubProvider = require('../lib/github');
const Operations = require('../business/operations');

// Asynchronous initialization for the Express app, configuration and data stores.
module.exports = function init(app, express, rootdir, config, configurationError, callback) {
  app.set('started', new Date());
  if (configurationError) {
    // Once app insights is available, will try to log this exception; display for now.
    console.dir(configurationError);
  }
  app.set('basedir', rootdir);
  var providers = {
    basedir: rootdir,
  };
  app.set('providers', providers);
  var dc;
  var redisClient;
  app.set('runtimeConfig', config);
  providers.healthCheck = healthCheck(app, config);
  var finalizeInitialization = (error) => {
    if (dc) {
      app.set('dataclient', dc);
      providers.dataClient = dc;
      providers.redisClient = redisClient;
      dc.cleanupInTheFuture = {
        redisClient: redisClient
      };
    }
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
          console.log('App crashed because of an initialization error.');
          console.dir(error);
          process.exit(1);
        };
      };
      if (appInsightsClient) {
        appInsightsClient.trackException(error, { info: 'App crashed while initializing' });
        try {
          appInsightsClient.sendPendingData(crash(error));
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
  app.use(require('./correlationId'));
  providers.insights = appInsights(app, config);
  app.set('appInsightsClient', providers.insights);

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
  var redisOptions = {
    auth_pass: config.redis.key,
    detect_buffers: true,
  };
  if (config.redis.tls) {
    redisOptions.tls = {
      servername: config.redis.tls,
    };
  }
  debug(`connecting to Redis ${config.redis.host || config.redis.tls}`);
  const port = config.redis.port || (config.redis.tls ? 6380 : 6379);
  redisClient = redis.createClient(port, config.redis.host || config.redis.tls, redisOptions);
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
    const witnessRedisOptions = {
      auth_pass: wr.key,
      detect_buffers: true,
    };
    if (wr.tls) {
      witnessRedisOptions.tls = {
        servername: wr.tls,
      };
    }
    wr.port = wr.port || wr.tls ? 6380 : 6379;
    providers.witnessRedis = redis.createClient(port, wr.host || wr.tls, witnessRedisOptions);
    providers.witnessRedisHelper = new RedisHelper(providers.witnessRedis);
  }

  async.parallel([
    function (cb) {
      const dataClientOptions = {
        config: config,
        keyEncryptionKeyResolver: keyEncryptionKeyResolver,
      };
      new DataClient(dataClientOptions, function (error, dcInstance) {
        dc = dcInstance;
        debug(`Azure Storage ready: ${dc.options.partitionKey} ${dc.options.linksTableName}`);
        providers.dataClient = dc;
        if (error) {
          return cb(error);
        }

        // Create GitHub library
        const options = {
          config: config,
          redis: redisHelper,
          dataClient: dc,
          insights: app.get('appInsightsClient'),
        };
        const libraryContext = githubProvider(options);
        providers.github = libraryContext;
        app.set('githubLibrary', libraryContext);
        cb();
      });
    },
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
    function createOptionalMailProvider(cb) {
      mailProvider(config, (providerInitError, provider) => {
        if (providerInitError) {
          return cb(providerInitError);
        }
        app.set('mailProvider', provider);
        providers.mailProvider = provider;
        cb();
      });
    },
    function createGraphProvider(cb) {
      // The graph provider is optional. A graph provider can connect to a
      // corporate directory to validate or lookup employees and other
      // directory members at runtime to gather additional information.
      graphProvider(config, (providerInitError, provider) => {
        if (providerInitError) {
          console.warn(providerInitError);
        } else {
          app.set('graphProvider', provider);
          providers.graphProvider = provider;
        }
        return cb();
      });
    },
    function createOssDbProvider(cb) {
      if (config.skipModules && config.skipModules.has('ossDbProvider')) {
        return cb();
      }
      const dbConfig = {
        server: config.legacySqlDatabase.server,
        user: config.legacySqlDatabase.username,
        password: config.legacySqlDatabase.password,
        database: config.legacySqlDatabase.database,
        options: {
          encrypt: true
        }
      };
      const connection = new sql.Connection(dbConfig, (connectError) => {
        const appInsightsClient = app.get('appInsightsClient');
        if (connectError && appInsightsClient) {
          appInsightsClient.trackException(connectError, { info: 'Could not connect to the legacy OSS management database.' });
        } else if (connectError) {
          console.dir(connectError);
        } else {
          app.set('ossDbConnection', connection);
          providers.ossDbConnection = connection;
          debug('connected to legacy oss management database');
        }
        cb();
      });
    },
  ], function (error) {
    if (!error) {
      const operations = new Operations(providers);
      app.set('operations', operations);
      providers.operations = operations;
    }
    finalizeInitialization(error);
  });
};
