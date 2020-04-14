//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IEventRecordProvider, IEventRecordProviderCreateOptions, EventRecordProvider } from './eventRecordProvider';

export async function createAndInitializeEventRecordProviderInstance(options?: IEventRecordProviderCreateOptions): Promise<IEventRecordProvider> {
  const provider = new EventRecordProvider(options);
  await provider.initialize();
  return provider;
}
