//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootContinuousDeployment = {
  continuousDeployment: ConfigContinuousDeployment;
};

export type ConfigContinuousDeployment = {
  branchName: string;
  build: string;
  commitId: string;
  version: string;
  name: string;
};
