//
// Copyright (c) Microsoft. All Rights Reserved.
//

import {
  CustomAppPurposeOrganizationVariance,
  GitHubAppConfiguration,
  GitHubAppPurposes,
} from '../lib/github/appPurposes.js';
import { CreateError } from '../lib/transitional.js';
import getCompanySpecificDeployment from '../middleware/companySpecificDeployment.js';

import type { IProviders } from '../interfaces/index.js';

const appPurposeId = 'enterprise-management';
const appPurposeName = 'Enterprise Management';
const appTypeName = 'EnterpriseManagementApp';

export class EnterpriseManagementApp {
  private static _instance: EnterpriseManagementApp;

  public static get AppPurpose() {
    return EnterpriseManagementApp.Instance.appPurpose;
  }

  public static get Instance() {
    if (!this._instance) {
      throw new Error(`${appTypeName} not initialized`);
    }
    return this._instance;
  }

  static Initialize(providers: IProviders) {
    if (this._instance) {
      throw CreateError.InvalidParameters(`${appTypeName} already initialized`);
    }
    const companySpecific = getCompanySpecificDeployment();
    // The open source variant of the app does not contemplate specific configuration
    // for enterprises.
    const hasEnterpriseFunction = !!companySpecific?.features?.enterprises;
    const configurations: GitHubAppConfiguration[] = hasEnterpriseFunction
      ? companySpecific.features.enterprises.getEnterpriseConfigurations(providers)
      : [];
    if (configurations.length === 0) {
      throw CreateError.InvalidParameters(
        'This system is not configured for GitHub Enterprise management.' +
          (hasEnterpriseFunction
            ? ' No company-specific functions are configured for retrieving the configuration.'
            : '')
      );
    }
    const customAppPurpose = new CustomAppPurposeOrganizationVariance(
      providers.operations,
      appPurposeId,
      appPurposeName,
      configurations
    );
    GitHubAppPurposes.RegisterCustomPurpose(customAppPurpose);
    EnterpriseManagementApp._instance = new EnterpriseManagementApp(customAppPurpose);
  }

  constructor(
    readonly appPurpose: CustomAppPurposeOrganizationVariance // ICustomAppPurpose
  ) {}
}
