//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ITableEntityMetadataProviderOptions, TableEntityMetadataProvider } from './table.js';
import { MemoryConfiguration, MemoryEntityMetadataProvider, MemorySettings } from './memory.js';
import { IPostgresEntityMetadataProviderOptions, PostgresEntityMetadataProvider } from './postgres.js';

import type { IEntityMetadataProvider } from './entityMetadataProvider.js';
import type { IProviders } from '../../interfaces/providers.js';

export * from './entityMetadataProvider.js';
export * from './query.js';
export * from './declarations.js';
export * from './entityMetadata.js';

export { MemoryConfiguration, MemorySettings };
export { PostgresConfiguration, PostgresSettings } from './postgres.js';
export { TableConfiguration, TableSettings } from './table.js';

const providerTypes = ['memory', 'table', 'postgres'];

const defaultProviderName = 'memory';

export const keyValueMetadataField = 'additionalData';

export interface IEntityMetadataProvidersOptions {
  providers: IProviders;
  tableOptions?: ITableEntityMetadataProviderOptions;
  postgresOptions?: IPostgresEntityMetadataProviderOptions;
  providerTypeName?: string;
}

export async function createAndInitializeEntityMetadataProviderInstance(
  options: IEntityMetadataProvidersOptions,
  overrideProviderType?: string
): Promise<IEntityMetadataProvider> {
  if (overrideProviderType) {
    options.providerTypeName = overrideProviderType;
  }
  const provider = createEntityMetadataProviderInstance(options);
  await provider.initialize();
  return provider;
}

export function createEntityMetadataProviderInstance(
  options: IEntityMetadataProvidersOptions
): IEntityMetadataProvider {
  const providerName = options.providerTypeName || defaultProviderName; // config.github.approvals.provider.name
  switch (providerName) {
    case 'memory':
      return new MemoryEntityMetadataProvider();

    case 'postgres':
      return new PostgresEntityMetadataProvider(options.postgresOptions);

    case 'table':
      return new TableEntityMetadataProvider(options.providers, options.tableOptions);

    default:
      throw new Error(`${providerName} EntityMetadataProvider not implemented`);
  }
}
