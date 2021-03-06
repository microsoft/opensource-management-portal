//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import path from 'path';
import { ICompanySpecificStartup } from '../interfaces';

import AppPackage from '../package.json';

let instance = null;

function getCompanySpecificDeploymentName() {
  const asAny = AppPackage as any;
  if (asAny?.companySpecificDeploymentDirectory) {
    return asAny.companySpecificDeploymentDirectory as string;
  }
}

function getCompanySpecificDeployment(): ICompanySpecificStartup {
  const name = getCompanySpecificDeploymentName();
  if (!name) {
    return null;
  }
  if (instance) {
    return instance;
  }
  try {
    const dynamicInclude = require(path.join(__dirname, '..', name));
    const entrypoint = dynamicInclude && dynamicInclude.default ? dynamicInclude.default : dynamicInclude;
    instance = entrypoint;
    return instance;
  } catch (includeError) {
    throw includeError;
  }
}

export default getCompanySpecificDeployment;
