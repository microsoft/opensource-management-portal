//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import Debug from 'debug';
import objectPath from 'object-path';
import { URL } from 'url';

// Configuration Assumptions:
// In URL syntax, we define a custom scheme of "env://" which resolves
// an environment variable in the object, directly overwriting the
// original value.
//
// For example:
//   "env://HOSTNAME" will resolve on a Windows machine to its hostname
//
// Note that this use of a custom scheme called "env" is not an officially
// recommended or supported thing, but it has worked great for us!

const envProtocol = 'env:';

const debug = Debug.debug('config');

export interface IEnvironmentProvider {
  get: (key: string) => string | undefined;
}

export interface IEnvironmentProviderOptions {
  provider?: IEnvironmentProvider;
  overrideValues?: Record<string, string>;
}

type EnvironmentValueType = string | number | boolean | Date | undefined;

function getUrlIfEnvironmentVariable(value: string) {
  try {
    const u = new URL(value);
    // const u = url.parse(value, true /* parse query string */);
    if (u.protocol === envProtocol) {
      return u;
    }
  } catch (typeError) {
    /* ignore */
  }
  return null;
}

function identifyPaths(node: any, prefix?: string) {
  prefix = prefix !== undefined ? prefix + '.' : '';
  const paths: any = {};
  for (const property in node) {
    const value = node[property];
    if (typeof value === 'object') {
      Object.assign(paths, identifyPaths(value, prefix + property));
      continue;
    }
    if (typeof value !== 'string') {
      continue;
    }
    const envUrl = getUrlIfEnvironmentVariable(value);
    if (!envUrl) {
      continue;
    }
    const originalHostname = value.substr(
      value.indexOf(envProtocol) + envProtocol.length + 2,
      envUrl.hostname.length
    );
    if (originalHostname.toLowerCase() === envUrl.hostname.toLowerCase()) {
      envUrl.hostname = originalHostname;
    }
    paths[prefix + property] = envUrl;
  }
  return paths;
}

export function processEnvironmentProvider(options?: IEnvironmentProviderOptions) {
  return {
    get: (key: string) => {
      const { overrideValues } = options || {};
      if (overrideValues && overrideValues[key] && overrideValues[key] !== process.env[key]) {
        const overrideOrSetDescriptor = process.env[key] === undefined ? 'Setting' : 'Overriding';
        debug(
          `${overrideOrSetDescriptor} environment variable ${key} to .env value "${overrideValues[key]}" instead of value "${process.env[key]}" from process.env`
        );
      }
      return overrideValues && overrideValues[key] ? overrideValues[key] : process.env[key];
    },
  };
}

function createClient(options: IEnvironmentProviderOptions) {
  options = options || {};
  const provider = options.provider || processEnvironmentProvider(options);
  return {
    resolveObjectVariables: async (object: any) => {
      let paths = null;
      try {
        paths = identifyPaths(object);
      } catch (parseError) {
        throw parseError;
      }
      const names = Object.getOwnPropertyNames(paths);
      for (let i = 0; i < names.length; i++) {
        const path = names[i];
        const parsed = paths[path] as URL;
        const variableName = parsed.hostname;
        let variableValue: EnvironmentValueType = provider.get(variableName);
        const hasQueryKey = (key: string) => {
          return parsed.search && parsed.searchParams.has(key);
        };
        const getQueryKey = (key: string) => {
          return parsed.search && parsed.searchParams.get(key);
        };
        // Support for default variables
        if (variableValue === undefined && hasQueryKey('default')) {
          variableValue = getQueryKey('default');
        }
        // Loose equality "true" for boolean values
        if (hasQueryKey('trueIf')) {
          variableValue = getQueryKey('trueIf') == /* loose */ variableValue;
        }
        // If a defined "ignore moniker" is present, replace it
        // with empty (designed for Codespaces scenarios)
        if (hasQueryKey('ignoreMoniker')) {
          const ignoreMoniker = getQueryKey('ignoreMoniker');
          if (ignoreMoniker) {
            variableValue = ((variableValue as string) || '').replace(ignoreMoniker, '');
          }
        }
        // Cast if a type is set to 'boolean' or 'integer'
        if (hasQueryKey('type')) {
          const currentValue = variableValue;
          const type = getQueryKey('type');
          switch (type) {
            case 'boolean':
            case 'bool': {
              if (
                currentValue &&
                currentValue !== 'false' &&
                currentValue != '0' &&
                currentValue !== 'False'
              ) {
                variableValue = true;
              } else {
                variableValue = false;
              }
              break;
            }
            case 'date': {
              variableValue = new Date(currentValue as string);
              break;
            }
            case 'integer':
            case 'int': {
              const attemptedValue = parseInt(currentValue as string, 10);
              if (currentValue === undefined) {
                variableValue = currentValue;
              } else if (isNaN(attemptedValue)) {
                console.warn(
                  `The value "${currentValue}" for the env:// variable "${variableName}" is not a valid integer. Using the original value instead.`
                );
                variableValue = currentValue;
              } else {
                variableValue = attemptedValue;
              }
              break;
            }
            default: {
              throw new Error(
                `The "type" parameter for the env:// string was set to "${type}", a type that is currently not supported.`
              );
            }
          }
        }
        objectPath.set(object, path, variableValue);
      }
    },
  };
}

export default createClient;
