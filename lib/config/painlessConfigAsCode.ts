//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import appRoot from 'app-root-path';
//import Debug from 'debug';
import dotenv from 'dotenv';
import path from 'path';
import walkBack from 'walk-back';
import { InnerError, IPainlessConfigGet, IProviderOptions } from '.';
import { processEnvironmentProvider } from './environmentConfigurationResolver';

//const debug = Debug('startup');

const ApplicationNameEnvironmentVariableKey = 'APPLICATION_NAME';

const debug = (a: any) => {};

function objectProvider(json: any, applicationName: string) {
  const appKey = applicationName ? `app:${applicationName}` : null;
  return {
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

let unconfigured: IPainlessConfigGet | null = null;

function configurePackageEnvironments(
  providers: IPainlessConfigGet[],
  appRoot: string,
  environmentModules: string[],
  environment: string,
  appName: string
) {
  let environmentInstances = [];
  for (let i = 0; i < environmentModules.length; i++) {
    // CONSIDER: Should the name strip any @ after the first slash, in case it is a version-appended version?
    let npmName = environmentModules[i].trim();
    if (!npmName) {
      continue;
    }
    // Local directory-as-module case
    if (npmName.startsWith('./')) {
      npmName = path.join(appRoot, npmName);
    }
    let environmentPackage = null;
    try {
      environmentPackage = require(npmName);
    } catch (packageRequireError) {
      const packageMissing: InnerError = new Error(
        `Unable to require the "${npmName}" environment package for the "${environment}" environment`
      );
      packageMissing.innerError = packageRequireError;
      throw packageMissing;
    }
    if (!environmentPackage) {
      continue;
    }

    let values = null;
    if (typeof environmentPackage === 'function') {
      environmentInstances.push(environmentPackage);
      try {
        values = environmentPackage(environment);
      } catch (problemCalling) {
        const asText = problemCalling.toString();
        const error: InnerError = new Error(
          `While calling the environment package "${npmName}" for the "${environment}" environment an error was thrown: ${asText}`
        );
        error.innerError = problemCalling;
        throw error;
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

function configureLocalEnvironment(
  providers: IPainlessConfigGet[],
  appRoot: string,
  directoryName: string,
  environment: string,
  applicationName: string
) {
  const envFile = `${environment}.json`;
  const envPath = path.join(appRoot, directoryName, envFile);
  try {
    const json = require(envPath);
    providers.push(objectProvider(json, applicationName));
  } catch (noFile) {
    // no file
  }
}

function tryGetPackage(appRoot: string) {
  try {
    const packagePath = path.join(appRoot, 'package.json');
    const pkg = require(packagePath);
    return pkg;
  } catch (noPackage) {
    // If there is no package.json for the app, well, that's OK
  }
}

function preloadDotEnv() {
  const dotenvPath = walkBack(process.cwd(), '.env');
  if (dotenvPath) {
    dotenv.config({ path: dotenvPath });
  }
}

function initialize(options?: IProviderOptions) {
  options = options || {};
  if (!options.skipDotEnv) {
    preloadDotEnv();
  }
  const provider = options.provider || processEnvironmentProvider();
  let environmentInstances = null;
  const applicationRoot = options.applicationRoot || appRoot;
  const applicationName = (options.applicationName ||
    provider.get(ApplicationNameEnvironmentVariableKey)) as string;

  const nodeEnvironment = provider.get('NODE_ENV');
  let configurationEnvironmentKeyNames = (
    provider.get('CONFIGURATION_ENVIRONMENT_KEYS') ||
    'CONFIGURATION_ENVIRONMENT,NODE_ENV'
  ).split(',');
  if (
    !configurationEnvironmentKeyNames ||
    configurationEnvironmentKeyNames.length === 0
  ) {
    throw new Error('No configuration environment key name(s) defined');
  }

  let environment = null;
  for (
    let i = 0;
    !environment && i < configurationEnvironmentKeyNames.length;
    i++
  ) {
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
    const pkg = tryGetPackage(appRoot);
    const appName =
      applicationName ||
      (pkg && pkg.painlessConfigApplicationName
        ? pkg.painlessConfigApplicationName
        : undefined);

    const environmentDirectoryKey =
      provider.get('ENVIRONMENT_DIRECTORY_KEY') || 'ENVIRONMENT_DIRECTORY';
    const directoryName =
      options.directoryName || provider.get(environmentDirectoryKey) || 'env';
    configureLocalEnvironment(
      providers,
      appRoot,
      directoryName,
      environment,
      appName
    );

    // const localEnvironmentModuleDirectoryKey = provider.get('ENVIRONMENT_MODULE_DIRECTORY_KEY') || 'ENVIRONMENT_MODULE_DIRECTORY';
    // const moduleDirectoryName = options.moduleDirectoryName || provider.get(localEnvironmentModuleDirectoryKey) || pkg.painlessConfigLocalEnvironmentModuleDirectory || 'env';
    // configureLocalEnvironment(providers, appRoot, directoryName, environment, appName);

    const environmentModulesKey =
      provider.get('ENVIRONMENT_MODULES_KEY') || 'ENVIRONMENT_MODULES';
    const environmentModules = (
      provider.get(environmentModulesKey) || ''
    ).split(',');
    let painlessConfigEnvironments = pkg
      ? pkg.painlessConfigEnvironments
      : null;
    if (painlessConfigEnvironments) {
      if (Array.isArray(painlessConfigEnvironments)) {
        // This is ready-to-use as-is
      } else if (painlessConfigEnvironments.split) {
        painlessConfigEnvironments = painlessConfigEnvironments.split(',');
      } else {
        throw new Error(
          'Unknown how to process the painlessConfigEnvironments values in package.json'
        );
      }
      environmentModules.push(...painlessConfigEnvironments);
    }
    environmentInstances = configurePackageEnvironments(
      providers,
      appRoot,
      environmentModules,
      environment,
      appName
    );
  }

  return {
    environmentInstances: environmentInstances,
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

initialize.get = function getWithoutInitialize(key: string) {
  if (unconfigured === null) {
    unconfigured = initialize();
  }
  return unconfigured.get(key);
};

export default initialize;
