//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ICompanySpecificStartup, ICompanySpecificStartupProperties } from '../interfaces/index.js';
import AppPackage from '../package.json' with { type: 'json' };

const companySpecificDeploymentEnvironmentVariable = 'COMPANY_SPECIFIC_DIRECTORY';
const ignoreCompanySpecificVariable = 'IGNORE_COMPANY_SPECIFIC_DIRECTORY';

let didWarn = false;

let instance = null;

function warnOnce(message: string) {
  if (didWarn) {
    return;
  }
  console.warn(message);
  didWarn = true;
}

function getCompanySpecificDeploymentName() {
  // We use only the process for overrides and not .env or painless config
  const processCompany = process.env[companySpecificDeploymentEnvironmentVariable];
  const skipCompany = !!process.env[ignoreCompanySpecificVariable];
  const asAny = AppPackage as any;
  if (asAny?.companySpecificDeploymentDirectory) {
    const asAnyValue = asAny.companySpecificDeploymentDirectory as string;
    if (skipCompany) {
      warnOnce(
        `The ${ignoreCompanySpecificVariable} environment variable is set, ignoring the company-specific directory configuration.`
      );
      return null;
    }
    if (processCompany !== undefined) {
      warnOnce(
        `The ${companySpecificDeploymentEnvironmentVariable} environment variable ("${processCompany}") overrides the package.json configuration ("${asAnyValue}").`
      );
      return processCompany;
    }
    return asAnyValue;
  }
  return processCompany;
}

function getCompanySpecificDeployment(): ICompanySpecificStartup {
  if (instance) {
    return instance;
  }
  const name = getCompanySpecificDeploymentName();
  if (!name) {
    return null;
  }
  throw new Error('needs to have initialization oops');
}

export async function tryInitializeCompanySpecificDeployment(): Promise<ICompanySpecificStartup> {
  if (instance) {
    return instance;
  }
  const name = getCompanySpecificDeploymentName();
  if (!name) {
    return null;
  }
  try {
    const pn = new URL(`../${name}/index.js`, import.meta.url).pathname;
    const dynamicInclude = await import(pn);
    const entrypoint = dynamicInclude && dynamicInclude.default ? dynamicInclude.default : dynamicInclude;
    if (!(entrypoint as ICompanySpecificStartupProperties).isCompanySpecific) {
      throw new Error(
        `The ${name} company-specific call did not include the 'isCompanySpecific' moniker. Check for circular dependencies: ${pn}`
      );
    }
    instance = entrypoint;
    return instance;
  } catch (includeError) {
    throw includeError;
  }
}

export default getCompanySpecificDeployment;
