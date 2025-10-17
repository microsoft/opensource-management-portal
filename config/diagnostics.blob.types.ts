//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigDiagnosticsRootBlob = {
  blob: ConfigDiagnosticsBlob;
};

export type ConfigDiagnosticsBlob = {
  account: string;
  container: string;
};
