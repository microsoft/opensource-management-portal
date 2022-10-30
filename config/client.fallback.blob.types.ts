//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigClientRootFallback = {
  fallback: ConfigClientFallback;
};

export type ConfigClientFallback = {
  blob: ConfigClientFallbackBlob;
};

export type ConfigClientFallbackBlob = {
  account: string;
  key: string;
  container: string;
};
