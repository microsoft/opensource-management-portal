//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootImmutable = {
  immutable: ConfigImmutable;
};

export type ConfigImmutable = {
  enabled: boolean;

  azure: {
    blob: ConfigImmutableAzureBlobStorage;
  };
};

export type ConfigImmutableAzureBlobStorage = {
  enabled: boolean;
  account: string;
  container: string;
};
