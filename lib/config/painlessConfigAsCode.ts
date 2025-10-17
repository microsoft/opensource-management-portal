//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import appRoot from 'app-root-path';
import Debug from 'debug';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import walkBack from 'walk-back';

import type { IPainlessConfigGet, IProviderOptions } from './index.js';

import { processEnvironmentProvider } from './environmentConfigurationResolver.js';
import { CreateError } from '../transitional.js';
import { importPathSchemeChangeIfWindows } from '../utils.js';

const debug = Debug.debug('config');

const APPLICATION_NAME_ENV_VAR_KEY = 'APPLICATION_NAME';
const DOT_ENV_OVERRIDES_PROCESS_ENV_VAR_KEY = 'PREFER_DOTENV';
const LOCAL_OVERRIDE_ENV_VAR_KEY = 'LOCAL_CONFIGURATION_ENVIRONMENT';

function objectProvider(json: any, applicationName: string) {
  const appKey = applicationName ? `app:${applicationName}` : null;
  return {
    providerName: 'object provider',
    get: function get(key: string) {
      if (appKey && json) {
        const appConfiguration = json[appKey];
        if (appConfiguration && appConfiguration[key]) {
          return appConfiguration[key];
        }
      }
      return json[key];
    },
  };
}

const unconfigured: IPainlessConfigGet | null = null;

async function configurePackageEnvironments(
  providers: IPainlessConfigGet[],
  appRoot: string,
  environmentModules: string[],
  environment: string,
  appName: string
) {
  const environmentInstances = [];
  for (let i = 0; i < environmentModules.length; i++) {
    // CONSIDER: Should the name strip any @ after the first slash, in case it is a version-appended version?
    let npmName = environmentModules[i].trim();
    if (!npmName) {
      continue;
    }
    // Local directory-as-module case
    if (npmName.startsWith('./')) {
      npmName = path.join(appRoot, npmName, 'index.js');
    }
    let environmentPackage = null;
    try {
      npmName = importPathSchemeChangeIfWindows(npmName);
      const imported = await import(npmName);
      const inc = imported.default || imported;
      environmentPackage = await inc;
    } catch (packageRequireError) {
      throw new Error(
        `Unable to require the "${npmName}" environment package for the "${environment}" environment`,
        { cause: packageRequireError }
      );
    }
    if (!environmentPackage) {
      continue;
    }

    let values = null;
    if (typeof environmentPackage === 'function') {
      environmentInstances.push(environmentPackage);
      try {
        values = await environmentPackage(environment);
      } catch (problemCalling) {
        const asText = problemCalling.toString() as string;
        let suggestion = '';
        if (asText.includes('Unable to require environment') && asText.includes('dist')) {
          suggestion = 'Consider deleting and rebuilding the `dist` directory. ';
        }
        throw CreateError.ServerError(
          `${suggestion}While calling the environment package "${npmName}" for the "${environment}" environment an error was thrown: ${asText}`,
          problemCalling
        );
      }
    } else if (typeof environmentPackage === 'object') {
      values = environmentPackage;
    }

    if (!values) {
      throw new Error(
        `Could not determine what to do with the environment package "${npmName}" for the "${environment}" environment (no values or unexpected type)`
      );
    }
    providers.push(objectProvider(values, appName));

    return environmentInstances;
  }
}

async function configureLocalEnvironment(
  providers: IPainlessConfigGet[],
  appRoot: string,
  directoryName: string,
  environment: string,
  applicationName: string
) {
  const envFile = `${environment}.json`;
  const envPath = path.join(appRoot, directoryName, envFile);
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    const json = JSON.parse(raw);
    providers.push(objectProvider(json, applicationName));
  } catch (noFile) {
    // no file
  }
}

async function tryGetPackage(appRoot: string) {
  try {
    const packagePath = path.join(appRoot, 'package.json');
    const raw = await fs.readFile(packagePath, 'utf8');
    const pkg = JSON.parse(raw);
    return pkg;
  } catch (noPackage) {
    // If there is no package.json for the app, well, that's OK
  }
}

function preloadDotEnv(dotEnvFilename: string): Record<string, string> {
  const dotenvPath = walkBack(process.cwd(), dotEnvFilename);
  if (dotenvPath) {
    const outcome = dotenv.config({ path: dotenvPath, quiet: true });
    if (outcome.error) {
      throw outcome.error;
    }
    if (outcome.parsed) {
      debug(`Parsed ${Object.keys(outcome.parsed).length} environment variables from ${dotenvPath}`);
      return outcome.parsed;
    }
  }
  return {};
}

async function initialize(options?: IProviderOptions) {
  options = options || {};
  // By capturing the values, we can override without relying on the default dotenv
  // approach and better log the outcomes.
  const envProviderOptions = { overrideValues: {} };
  const provider = options.provider || processEnvironmentProvider(envProviderOptions);
  const dotEnvFilename = provider.get('DOTENV_FILENAME') || '.env';
  const dotenvValues = !options.skipDotEnv ? preloadDotEnv(dotEnvFilename) : {};
  if (options.provider) {
    debug(`options.provider was provided: ${options.provider}. Skipping any .env values.`);
  }

  const preferDotEnvChoice = provider.get(DOT_ENV_OVERRIDES_PROCESS_ENV_VAR_KEY) === '1';
  if (preferDotEnvChoice) {
    // Yes, this is setting the value on the options object above and so is expecting
    // that the provider implementation is not destructing the options.
    envProviderOptions.overrideValues = dotenvValues;
    debug(
      `The ${DOT_ENV_OVERRIDES_PROCESS_ENV_VAR_KEY} environment variable was set to 1. Preferring .env file over process.env values.`
    );
  }
  let environmentInstances = null;
  const applicationRoot = options.applicationRoot || appRoot;
  const applicationName = (options.applicationName || provider.get(APPLICATION_NAME_ENV_VAR_KEY)) as string;

  const nodeEnvironment = provider.get('NODE_ENV');
  const configurationEnvironmentKeyNames = (
    provider.get('CONFIGURATION_ENVIRONMENT_KEYS') || 'CONFIGURATION_ENVIRONMENT,NODE_ENV'
  ).split(',');
  if (!configurationEnvironmentKeyNames || configurationEnvironmentKeyNames.length === 0) {
    throw new Error('No configuration environment key name(s) defined');
  }

  let environment = null;
  for (let i = 0; !environment && i < configurationEnvironmentKeyNames.length; i++) {
    environment = provider.get(configurationEnvironmentKeyNames[i]);
  }
  if (!environment) {
    return provider;
  }

  const matchWarning =
    nodeEnvironment !== environment
      ? ` [MISMATCH: NODE_ENV=${nodeEnvironment}, environment=${environment}]`
      : '';
  debug(`Configuration environment: ${environment}${matchWarning}`);

  const providers: IPainlessConfigGet[] = [provider];

  if ((provider as any).testConfiguration) {
    const testJson = (provider as any).testConfiguration;
    providers.push(objectProvider(testJson[environment], applicationName));
  } else {
    const appRoot = applicationRoot.toString();
    const pkg = await tryGetPackage(appRoot);
    const appName =
      applicationName ||
      (pkg && pkg.painlessConfigApplicationName ? pkg.painlessConfigApplicationName : undefined);

    const environmentDirectoryKey = provider.get('ENVIRONMENT_DIRECTORY_KEY') || 'ENVIRONMENT_DIRECTORY';
    const directoryName = options.directoryName || provider.get(environmentDirectoryKey) || 'env';
    await configureLocalEnvironment(providers, appRoot, directoryName, environment, appName);

    // const localEnvironmentModuleDirectoryKey = provider.get('ENVIRONMENT_MODULE_DIRECTORY_KEY') || 'ENVIRONMENT_MODULE_DIRECTORY';
    // const moduleDirectoryName = options.moduleDirectoryName || provider.get(localEnvironmentModuleDirectoryKey) || pkg.painlessConfigLocalEnvironmentModuleDirectory || 'env';
    // configureLocalEnvironment(providers, appRoot, directoryName, environment, appName);

    const environmentModulesKey = provider.get('ENVIRONMENT_MODULES_KEY') || 'ENVIRONMENT_MODULES';
    const environmentModules = (provider.get(environmentModulesKey) || '').split(',').filter((val) => val);
    let painlessConfigEnvironments = pkg ? pkg.painlessConfigEnvironments : null;
    if (painlessConfigEnvironments && environmentModules.length === 0) {
      if (Array.isArray(painlessConfigEnvironments)) {
        // This is ready-to-use as-is
      } else if (painlessConfigEnvironments.split) {
        painlessConfigEnvironments = painlessConfigEnvironments.split(',');
      } else {
        throw new Error('Unknown how to process the painlessConfigEnvironments values in package.json');
      }
      environmentModules.push(...painlessConfigEnvironments);
    }
    const localEnvironment = provider.get(LOCAL_OVERRIDE_ENV_VAR_KEY);
    if (localEnvironment) {
      debug(`Local override environment takes precedence: ${localEnvironment}`);
      await configurePackageEnvironments(providers, appRoot, environmentModules, localEnvironment, appName);
    }
    environmentInstances = await configurePackageEnvironments(
      providers,
      appRoot,
      environmentModules,
      environment,
      appName
    );
  }

  return {
    providerName: 'painless config',
    environmentInstances,
    get: function (key: string) {
      for (let i = 0; i < providers.length; i++) {
        const value = providers[i].get(key);
        if (value !== undefined) {
          return value;
        }
      }
    },
  };
}

// initialize.get = function getWithoutInitialize(key: string) {
//   if (unconfigured === null) {
//     unconfigured = initialize();
//   }
//   return unconfigured.get(key);
// };

export default initialize;
