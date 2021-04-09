//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export enum SecretScanningState {
  Resolved = 'resolved',
  Open = 'open',
}

export enum SecretScanningResolution {
  FalsePositive = 'false_positive',
  WontFix = 'wont_fix',
  Revoked = 'revoked',
  UsedInTests = 'used_in_tests',
}

export interface IGitHubSecretScanningAlert {
  number: number;
  created_at: string;
  url: string;
  html_url: string;
  state: SecretScanningState;
  resolution?: SecretScanningResolution;
  resolved_at?: string;
  resolved_by?: any;
  secret_type: string;
  secret: string;
}
