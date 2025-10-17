//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { AppInstallation } from './appInstallation.js';

export class AppInstallations {
  private static _instance: AppInstallations = new AppInstallations();

  public static get Instance() {
    return this._instance;
  }

  private _installations = new Map<number, AppInstallation>();

  private constructor() {}

  registerInstallation(installation: AppInstallation) {
    if (this._installations.has(installation.installPair.installationId)) {
      console.warn(`Installation ${installation.installPair.installationId} already registered; overriding`);
    }
    this._installations.set(installation.installPair.installationId, installation);
  }

  get(installationId: number): AppInstallation {
    return this._installations.get(installationId);
  }
}
