//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfiguredProbeBase = {
  allowed: boolean;
};

export type ConfiguredGeneralProbe = ConfiguredProbeBase & {
  endpointSuffix?: string;
  endpoint?: string;
};

export type ConfiguredHeaderProbe = ConfiguredProbeBase & {
  expectedHeader: {
    name: string;
    value: string;
  };
};

export type ConfigWebHealthProbes = {
  enabled: boolean;
  delay: {
    liveness: number;
    readiness: number;
  };
  kubernetes: ConfiguredHeaderProbe;
  'azureappservice-linux': ConfiguredGeneralProbe;
  'azureappservice-windows': ConfiguredGeneralProbe;
  azurefrontdoor: ConfiguredHeaderProbe;
  external: ConfiguredGeneralProbe;
};

export type ConfigRootWebHealthProbes = {
  webHealthProbes: ConfigWebHealthProbes;
};
