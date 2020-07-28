//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Router } from 'express';

import { IDictionary } from '../../transitional';

export interface ICorporationAdministrationSection {
  urls: IDictionary<string>;
  setupRoutes?: (router: Router) => void;
}

export default function LoadCorporationAdministrationProfile(): ICorporationAdministrationSection {
  let section: ICorporationAdministrationSection = null;
  try {
    const importedModule = require('./corporation/');
    section = importedModule && importedModule.default ? importedModule.default : importedModule;
  } catch (error) {
    console.dir(error);
  }
  return section;
}
