//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Express, NextFunction, Response } from 'express';
import path from 'path';

import { createAndInitializeLinkProviderInstance } from '../lib/linkProviders/index.js';
import { Operations } from '../business/index.js';
import {
  createAndInitializeEntityMetadataProviderInstance,
  IEntityMetadataProvidersOptions,
} from '../lib/entityMetadataProvider/index.js';
import { createAndInitializeRepositoryMetadataProviderInstance } from '../business/entities/repositoryMetadata/index.js';
import createAndInitializeOrganizationAnnotationProviderInstance from '../business/entities/organizationAnnotation.js';
import { createMailAddressProviderInstance, IMailAddressProvider } from '../lib/mailAddressProvider/index.js';
import ErrorRoutes from './errorRoutes.js';
import viewServices from '../lib/pugViewServices.js';

// NOTE: there are 2 dynamic imports in this file to '../routes/' and './alternateApps'

import pg from 'pg';
const { Pool: PostgresPool } = pg;

import Debug from 'debug';
const debug = Debug.debug('startup');
const pgDebug = Debug.debug('pgpool');
const nowDebug = Debug.debug('now');

import appInsights from './appInsights.js';
import keyVault from './keyVault.js';

import healthCheck from './healthCheck.js';

import { createAndInitializeApprovalProviderInstance } from '../business/entities/teamJoinApproval/index.js';
import { CreateGraphProviderInstance, IGraphProvider } from '../lib/graphProvider//index.js';
import initializeCorporateViews from './corporateViews.js';

import keyVaultResolver, { IKeyVaultSecretResolver } from '../lib/keyVaultResolver.js';

import { createMailProviderInstance } from '../lib/mailProvider//index.js';
import { RestLibrary } from '../lib/github/index.js';
import { CreateRepositoryCacheProviderInstance } from '../business/entities/repositoryCache/index.js';
import { CreateRepositoryCollaboratorCacheProviderInstance } from '../business/entities/repositoryCollaboratorCache/index.js';
import { CreateTeamCacheProviderInstance } from '../business/entities/teamCache/index.js';
import { CreateTeamMemberCacheProviderInstance } from '../business/entities/teamMemberCache/index.js';
import { CreateRepositoryTeamCacheProviderInstance } from '../business/entities/repositoryTeamCache/index.js';
import { CreateOrganizationMemberCacheProviderInstance } from '../business/entities/organizationMemberCache/index.js';
import QueryCache from '../business/queryCache.js';
import { createAndInitializeOrganizationSettingProviderInstance } from '../business/entities/organizationSettings/index.js';
import { IEntityMetadataProvider } from '../lib/entityMetadataProvider/entityMetadataProvider.js';
import { createAndInitializeAuditLogRecordProviderInstance } from '../business/entities/auditLogRecord/index.js';
import BlobCache from '../lib/caching/blob.js';
import { StatefulCampaignProvider } from '../lib/campaignState/campaigns.js';
import { SimplifiedCosmosHelper } from '../lib/cosmosHelper.js';
import { IQueueProcessor } from '../lib/queues/index.js';
import ServiceBusQueueProcessor from '../lib/queues/servicebus.js';
import AzureQueuesProcessor from '../lib/queues/azurequeue.js';
import { UserSettingsProvider } from '../business/entities/userSettings.js';
import getCompanySpecificDeployment from './companySpecificDeployment.js';

import routeCorrelationId from './correlationId.js';
import routeHsts from './hsts.js';
import routeSslify from './sslify.js';

import middlewareIndex from './index.js';
import initializeRepositoryProvider from '../business/entities/repository.js';
import { tryGetImmutableStorageProvider } from '../lib/immutable.js';
import { GitHubAppPurposes } from '../lib/github/appPurposes.js';
import {
  getEntraApplicationIdentity,
  tryGetEntraApplicationTokenCredential,
} from '../lib/applicationIdentity.js';
import { importPathSchemeChangeIfWindows } from '../lib/utils.js';

import type { ICacheHelper } from '../lib/caching/index.js';
import type {
  ExecutionEnvironment,
  ApplicationProfile,
  IProviders,
  IReposApplication,
  SiteConfiguration,
} from '../interfaces/index.js';
import type { ConfigDataPostgres } from '../config/data.postgres.types.js';
import { prepareSessionMiddleware } from './session/index.js';
import { initializeRestCache } from './cache/index.js';
import { CreateError } from '../lib/transitional.js';

const DefaultApplicationProfile: ApplicationProfile = {
  applicationName: 'Open Source Management Portal',
  serveStaticAssets: true,
  serveClientAssets: true,
  logDependencies: true,
  webServer: true,
  sessions: true,
};

type CompanyStartupEntrypoint = (
  config: SiteConfiguration,
  providers: IProviders,
  rootdir: string
) => Promise<void>;

async function initializeAsync(
  executionEnvironment: ExecutionEnvironment,
  providers: IProviders,
  // app: IReposApplication,
  // express,
  rootdir: string,
  config: SiteConfiguration
): Promise<void> {
  const companySpecific = getCompanySpecificDeployment();
  providers.postgresPool = await connectPostgresPool(config.data.postgres);
  providers.linkProvider = await createAndInitializeLinkProviderInstance(providers, config);
  await initializeRestCache(providers);

  const immutable = tryGetImmutableStorageProvider(providers, config);
  if (immutable) {
    await immutable.initialize();
    providers.immutable = immutable;
  }

  providers.graphProvider = await createGraphProvider(providers, config);
  providers.mailAddressProvider = await createMailAddressProvider(config, providers);

  const mailProvider = createMailProviderInstance(providers, config);
  if (mailProvider) {
    const mailInitializedMessage = await mailProvider.initialize();
    debug(`mail provider type=${config.mail.provider} ${mailInitializedMessage}`);
    providers.mailProvider = mailProvider;
  } else {
    debug(`mail provider *NOT* initialized, type=${config.mail.provider}`);
  }

  providers.github = configureGitHubLibrary(providers.cacheProvider, config);

  // always check if config exists to prevent crashing because of trying to access an undefined object
  const emOptions: IEntityMetadataProvidersOptions = {
    providers,
    tableOptions: {
      account: config.github?.links?.table?.account,
      key: config.github?.links?.table?.key,
      useEntraAuthentication: config.github?.links?.table?.useEntraAuthentication,
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
  const tableProviderEnabled = emOptions.tableOptions && emOptions.tableOptions.account;
  const tableEntityMetadataProvider = tableProviderEnabled
    ? await createAndInitializeEntityMetadataProviderInstance(emOptions, 'table')
    : null;
  const postgresProviderEnabled = emOptions.postgresOptions && emOptions.postgresOptions.pool;
  const pgEntityMetadataProvider = postgresProviderEnabled
    ? await createAndInitializeEntityMetadataProviderInstance(emOptions, 'postgres')
    : null;
  const memoryEntityMetadataProvider = await createAndInitializeEntityMetadataProviderInstance(
    emOptions,
    'memory'
  );
  const defaultProvider =
    pgEntityMetadataProvider || tableEntityMetadataProvider || memoryEntityMetadataProvider;
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
  providers.getEntityProviderByType = providerNameToInstance;
  providers.defaultEntityMetadataProvider = defaultProvider;
  providers.approvalProvider = await createAndInitializeApprovalProviderInstance({
    entityMetadataProvider: providerNameToInstance(config.entityProviders.teamjoin),
  });
  providers.organizationMemberCacheProvider = await CreateOrganizationMemberCacheProviderInstance({
    entityMetadataProvider: providerNameToInstance(config.entityProviders.organizationmembercache),
  });
  providers.organizationSettingsProvider = await createAndInitializeOrganizationSettingProviderInstance({
    entityMetadataProvider: providerNameToInstance(config.entityProviders.organizationsettings),
  });
  if (config?.github?.annotations?.enabled) {
    providers.organizationAnnotationsProvider =
      await createAndInitializeOrganizationAnnotationProviderInstance({
        entityMetadataProvider: providerNameToInstance(config.entityProviders.organizationannotations),
      });
  }
  providers.repositoryCacheProvider = await CreateRepositoryCacheProviderInstance({
    entityMetadataProvider: providerNameToInstance(config.entityProviders.repositorycache),
  });
  providers.repositoryCollaboratorCacheProvider = await CreateRepositoryCollaboratorCacheProviderInstance({
    entityMetadataProvider: providerNameToInstance(config.entityProviders.repositorycollaboratorcache),
  });
  providers.repositoryTeamCacheProvider = await CreateRepositoryTeamCacheProviderInstance({
    entityMetadataProvider: providerNameToInstance(config.entityProviders.repositoryteamcache),
  });
  providers.teamCacheProvider = await CreateTeamCacheProviderInstance({
    entityMetadataProvider: providerNameToInstance(config.entityProviders.teamcache),
  });
  providers.teamMemberCacheProvider = await CreateTeamMemberCacheProviderInstance({
    entityMetadataProvider: providerNameToInstance(config.entityProviders.teammembercache),
  });
  providers.auditLogRecordProvider = await createAndInitializeAuditLogRecordProviderInstance({
    entityMetadataProvider: providerNameToInstance(config.entityProviders.auditlogrecord),
  });
  providers.userSettingsProvider = new UserSettingsProvider({
    entityMetadataProvider: providerNameToInstance(config.entityProviders.usersettings),
  });
  providers.repositoryProvider = await initializeRepositoryProvider({
    entityMetadataProvider: providerNameToInstance(config.entityProviders.repository),
  });
  await providers.userSettingsProvider.initialize();
  providers.queryCache = new QueryCache(providers);
  if (config?.campaigns?.provider) {
    if (companySpecific?.features?.campaignStateProvider) {
      providers.campaignStateProvider =
        await companySpecific.features.campaignStateProvider.tryCreateInstance(providers, config);
    }
    if (!providers.campaignStateProvider) {
      if (config.campaigns.provider === 'cosmosdb') {
        const campaignCosmosStore = new SimplifiedCosmosHelper(providers, config.campaigns.cosmosdb);
        await campaignCosmosStore.initialize();
        providers.campaignStateProvider = new StatefulCampaignProvider(campaignCosmosStore);
      } else if (config.campaigns.provider) {
        throw new Error(`Campaigns provider ${config.campaigns.provider} is not supported`);
      }
    }
  }
  await prepareSessionMiddleware(providers);
  if (config?.diagnostics?.blob?.account) {
    providers.diagnosticsDrop = new BlobCache({
      account: config.diagnostics.blob.account,
      container: config.diagnostics.blob.container,
      tokenCredential: tryGetEntraApplicationTokenCredential(providers, 'diagnostics'),
    });
    await providers.diagnosticsDrop.initialize();
  }
  providers.corporateAdministrationProfile = companySpecific?.administrationSection;
  providers.corporateViews = await initializeCorporateViews(providers, rootdir);

  await dynamicStartup(executionEnvironment, config, providers, rootdir);

  const webhooksConfig = config.github.webhooks;
  if (webhooksConfig?.provider) {
    const isJob = executionEnvironment.isJob;
    let webhooksProvider: IQueueProcessor = null;
    if (companySpecific?.features?.queues) {
      webhooksProvider = await companySpecific.features.queues.tryCreateInstance(providers, config);
    }
    if (!webhooksProvider) {
      switch (webhooksConfig.provider) {
        case 'servicebus': {
          const serviceBusConfig = webhooksConfig.serviceBus;
          // If any web APIs need to connect to the bus, they will use a separate
          // AMQP mode with Service Bus.
          const options = {
            ...serviceBusConfig,
            ...{
              immediatelyDeleteMessages: !isJob,
              maximumMessagesPerRequest: isJob ? undefined : 1,
            },
          };
          webhooksProvider = new ServiceBusQueueProcessor(providers, options);
          break;
        }
        case 'azurequeues': {
          const queuesConfig = webhooksConfig.azureQueues;
          webhooksProvider = new AzureQueuesProcessor(providers, queuesConfig);
          break;
        }
        default: {
          throw CreateError.InvalidParameters(`Unsupported webhooks provider: ${webhooksConfig.provider}`);
        }
      }
    }
    if (webhooksProvider) {
      await webhooksProvider.initialize();
      providers.webhookQueueProcessor = webhooksProvider;
    }
  }

  try {
    const repositoryMetadataProvider = await createAndInitializeRepositoryMetadataProviderInstance({
      entityMetadataProvider: providerNameToInstance(config.entityProviders.repositorymetadata),
    });
    const operations = new Operations({
      executionEnvironment,
      providers,
      repositoryMetadataProvider,
      github: providers.github,
    });
    await operations.initialize();
    providers.operations = operations;
    GitHubAppPurposes.RegisterOperationsInstanceForBuiltInPurposes(operations);
  } catch (ignoredError2) {
    console.dir(ignoredError2);
    throw ignoredError2;
  }

  await dynamicStartup(executionEnvironment, config, providers, rootdir, 'secondary');

  if (providers.applicationProfile.startup) {
    debug('Application provider-specific startup...');
    await providers.applicationProfile.startup(providers);
  }
}

function configureGitHubLibrary(cacheProvider: ICacheHelper, config: SiteConfiguration): RestLibrary {
  const libraryContext = new RestLibrary({
    config,
    cacheProvider,
  });
  return libraryContext;
}

// Asynchronous initialization for the Express app, configuration and data stores.
export default async function initialize(
  executionEnvironment: ExecutionEnvironment,
  app: IReposApplication,
  rootdir: string,
  config: SiteConfiguration,
  exception: Error
): Promise<ExecutionEnvironment> {
  if (exception) {
    if (`${exception}` === '[object Object]') {
      console.dir(exception);
    } else {
      console.warn(`Startup exception: ${exception}`);
    }
  }
  if (!config || Object.getOwnPropertyNames(config).length === 0) {
    throw new Error('Empty configuration object');
  }
  if (app && !app.runtimeConfiguration) {
    app.runtimeConfiguration = {};
  }
  let applicationProfile: ApplicationProfile = null;
  if (config?.web?.app === 'repos') {
    applicationProfile = DefaultApplicationProfile;
  } else {
    try {
      const alternateRoutes = await import('./alternateApps.js');
      applicationProfile = await alternateRoutes.initializeAlternateApps(config, app, config.web.app);
    } catch (alternateRoutesError) {
      throw new Error(`Alternate routes could not be loaded: ${alternateRoutesError}`, {
        cause: alternateRoutesError,
      });
    }
  }
  const web = false === executionEnvironment.skipModules.has('web');
  if (applicationProfile.webServer && !web) {
    applicationProfile.webServer = false;
  }
  const containerPurpose = executionEnvironment.isJob
    ? 'job'
    : applicationProfile.webServer
      ? 'web application'
      : 'application';
  if (executionEnvironment.entrypointName) {
    debug(`${containerPurpose} name: ${executionEnvironment.entrypointName}`);
  }
  debug(`${containerPurpose} profile: ${applicationProfile.applicationName}`);
  debug(`environment: ${config?.debug?.environmentName || 'Unknown'}`);
  if (config?.continuousDeployment) {
    const values = Object.values(config.continuousDeployment).filter((x) => x);
    if (values.length > 0) {
      debug(`build: ${values.join(', ')}`);
    }
  }

  const codespacesConfig = (config as SiteConfiguration)?.github?.codespaces;
  if (codespacesConfig?.connected === true && codespacesConfig.block === true) {
    throw Error(
      `This environment is not designed for use with GitHub Codespaces but you are currently connected to a Codespaces editor session (${process.env.CODESPACE_NAME}).`
    );
  } else if (codespacesConfig.connected === true) {
    let codespacesPort = undefined;
    if (codespacesConfig?.connected === true) {
      codespacesPort = codespacesConfig.authentication?.port;
    }
    const configuredType = codespacesConfig.desktop ? 'desktop' : 'web';
    const authPort = codespacesPort || process.env.PORT || 3000;
    debug(`codespace: type=${configuredType}, name=${config.github.codespaces.name}, auth_port=${authPort}`);
  }

  if (!exception && applicationProfile.validate) {
    try {
      await applicationProfile.validate();
    } catch (error) {
      exception = error;
    }
  }
  if (app) {
    app.set('started', executionEnvironment.started);
    app.config = config;
  }
  if (exception) {
    // Once app insights is available, will try to log this exception; display for now.
    console.dir(exception);
  }
  if (app) {
    app.set('basedir', rootdir);
  }
  const providers: IProviders = {
    app,
    basedir: rootdir,
    applicationProfile,
  };
  executionEnvironment.providers = providers;
  if (app) {
    app.set('providers', providers);
    app.providers = providers;
    app.set('runtimeConfig', config);
  }
  providers.healthCheck = await healthCheck(app, config);
  if (applicationProfile.webServer) {
    if (!app) {
      throw new Error('app (Express) is required for web applications');
    } else if (!app.startServer) {
      throw new Error(`app.startServer is required for web applications`);
    }
    await app.startServer();
    if (executionEnvironment.isJob) {
      debug('Server started alongside job preparation.');
    }
  }
  if (app) {
    app.use(routeCorrelationId);
  }
  const insights = appInsights(providers, executionEnvironment, app, config);
  providers.insights = insights;
  if (!exception && (!config || !config.activeDirectory)) {
    exception = new Error(
      `config.activeDirectory.clientId and config.activeDirectory.clientSecret are required to initialize KeyVault`
    );
  }
  if (app) {
    app.use('/*splat', (req, res: Response, next: NextFunction) => {
      if (providers.healthCheck.ready) {
        return next();
      }
      return res.send('Service not ready.') as unknown as void;
    });
  }
  // See docs/configuration.md for all this
  if (app) {
    if (config?.containers?.deployment) {
      debug('Container deployment: HTTP: listening, HSTS: on');
      app.use(routeHsts);
    } else if (config?.containers?.docker) {
      debug('Docker image: HTTP: listening, HSTS: off');
    } else if (config.webServer.allowHttp) {
      debug('development mode: HTTP: listening, HSTS: off');
    } else {
      debug('non-container production mode: HTTP: redirect to HTTPS, HSTS: on');
      const sslifyRouter = routeSslify(config.webServer);
      if (sslifyRouter) {
        app.use(sslifyRouter);
      }
    }
  }
  if (!exception) {
    providers.config = config;
    let keyEncryptionKeyResolver: IKeyVaultSecretResolver = null;
    try {
      const keyVaultClient = keyVault(providers);
      keyEncryptionKeyResolver = keyVaultResolver(keyVaultClient);
      if (app) {
        app.set('keyEncryptionKeyResolver', keyEncryptionKeyResolver);
      }
      providers.keyEncryptionKeyResolver = keyEncryptionKeyResolver;
      debug('configuration secrets resolved');
    } catch (noKeyVault) {
      throw noKeyVault;
    }
    try {
      await initializeAsync(executionEnvironment, providers, rootdir, config);
    } catch (initializeError) {
      console.dir(initializeError);
      debug(`Initialization failure: ${initializeError}`);
      exception = initializeError;
    }
  }
  const hasCustomRoutes = !!applicationProfile.customRoutes;
  providers.viewServices = viewServices;
  try {
    if (app) {
      const express = (app as any)?.expressInstance as Express;
      await middlewareIndex(app, express, providers, config, rootdir, hasCustomRoutes, exception);
    }
  } catch (middlewareError) {
    exception = middlewareError;
  }
  // ROUTES:
  let standardExpressRoutes = null;
  if (!exception && !hasCustomRoutes && app) {
    try {
      const module = await import('../routes/index.js');
      if (!module.default) {
        throw new Error('No default export from routes/index.js');
      }
      standardExpressRoutes = module.default;
    } catch (routesError) {
      exception = new Error(`Standard routes could not be loaded: ${routesError}`, { cause: routesError });
    }
  }
  if (!exception) {
    if (hasCustomRoutes) {
      await applicationProfile.customRoutes(providers);
    } else if (app) {
      app.use('/', standardExpressRoutes);
    }
  } else {
    console.error(exception);
    const crash = (error: Error) => {
      return () => {
        debug('App crashed because of an initialization error.');
        console.log(error.message);
        if (error.stack) {
          console.log(error.stack);
        }
        process.exit(1);
      };
    };
    if (insights) {
      insights.trackException({
        exception,
        properties: {
          info: 'App crashed while initializing',
        },
      });
      try {
        insights.flush();
      } catch (sendError) {
        console.error(`Unable to flush insights: ${sendError}`);
      } finally {
        crash(exception)();
      }
    } else {
      crash(exception)();
    }
  }
  await ErrorRoutes(app, exception);
  if (config?.debug?.breakConsoleEveryMinute === true) {
    const isNowDebugging = Debug.enabled('now');
    const everyMinute = () => {
      const display = new Date().toISOString().substring(0, 19).replace('T', ' ');
      if (isNowDebugging) {
        nowDebug(display);
      } else {
        console.log();
        console.log(display);
      }
    };
    everyMinute();
    setInterval(everyMinute, 60000);
  }
  return executionEnvironment;
}

function createGraphProvider(providers: IProviders, config: SiteConfiguration): Promise<IGraphProvider> {
  return new Promise((resolve, reject) => {
    // The graph provider is optional. A graph provider can connect to a
    // corporate directory to validate or lookup employees and other
    // directory members at runtime to gather additional information.
    CreateGraphProviderInstance(providers, config, (providerInitError: Error, provider: IGraphProvider) => {
      if (providerInitError) {
        debug(`No org chart graph provider configured: ${providerInitError.message}`);
        if (config.graph?.require === true) {
          return reject(new Error(`Unable to initialize the graph provider: ${providerInitError.message}`));
        }
      } else {
        return resolve(provider);
      }
      return resolve(null);
    });
  });
}

export function connectPostgresPool(postgresConfigSection: ConfigDataPostgres): Promise<pg.Pool> {
  return new Promise((resolve, reject) => {
    try {
      if (postgresConfigSection && postgresConfigSection.user) {
        const pool = new PostgresPool(postgresConfigSection);
        // central
        pool.on('error', (err, client) => {
          pgDebug('POSTGRES POOL ERROR:');
          pgDebug(err);
        });
        pool.on('connect', (client) => {
          pgDebug(
            `Pool connecting a new client (pool: ${pool.totalCount} clients, ${pool.idleCount} idle, ${pool.waitingCount} waiting)`
          );
        });
        pool.on('acquire', (client) => {
          pgDebug(
            `Postgres client being checked out (pool: ${pool.totalCount} clients, ${pool.idleCount} idle, ${pool.waitingCount} waiting)`
          );
        });
        pool.on('remove', (client) => {
          pgDebug(
            `Postgres client checked back in (pool: ${pool.totalCount} clients, ${pool.idleCount} idle, ${pool.waitingCount} waiting)`
          );
        });
        // try connecting
        pool.connect((cause, client, release) => {
          if (cause) {
            const poolError = new Error(
              `There was a problem connecting to the Postgres server ${postgresConfigSection.host}`,
              {
                cause,
              }
            );
            return reject(poolError);
          }
          client.query('SELECT NOW()', (err, result) => {
            release();
            if (err) {
              const poolQueryError = new Error(
                'There was a problem performing a test query to the Postgres server',
                { cause: err }
              );
              return reject(poolQueryError);
            }
            debug(
              `postgres (${postgresConfigSection.host} ${postgresConfigSection.database} as ${postgresConfigSection.user}), pool of ${postgresConfigSection.max}`
            );
            return resolve(pool);
          });
        });
      } else {
        return resolve(undefined);
      }
    } catch (failProblem) {
      return reject(failProblem);
    }
  });
}

async function createMailAddressProvider(
  config: SiteConfiguration,
  providers: IProviders
): Promise<IMailAddressProvider> {
  const options = {
    config: config,
    providers: providers,
  };
  return createMailAddressProviderInstance(options);
}

async function dynamicStartup(
  executionEnvironment: ExecutionEnvironment,
  config: SiteConfiguration,
  providers: IProviders,
  rootdir: string,
  stage?: string
) {
  const p = config?.startup?.path;
  if (p) {
    try {
      let scriptPath = path.join(rootdir, p, 'index.js');
      scriptPath = importPathSchemeChangeIfWindows(scriptPath);
      const dynamicInclude = await import(scriptPath);
      let entrypoint = dynamicInclude && dynamicInclude.default ? dynamicInclude.default : dynamicInclude;
      if (stage && !dynamicInclude[stage]) {
        return;
      } else if (stage) {
        entrypoint = dynamicInclude[stage];
      }
      if (typeof entrypoint !== 'function') {
        throw new Error(`Entrypoint ${p} is not a function`);
      }
      const promise = (entrypoint as CompanyStartupEntrypoint).call(
        null,
        executionEnvironment,
        config,
        providers,
        rootdir
      ) as Promise<void>;
      await promise;
      debug(`company-specific ${stage || 'startup'} complete (${p})`);
    } catch (dynamicLoadError) {
      if (dynamicLoadError.stack) {
        console.error(dynamicLoadError.stack);
      }
      throw new Error(`config.startup.path=${p} could not successfully load: ${dynamicLoadError}`);
    }
  }
}
