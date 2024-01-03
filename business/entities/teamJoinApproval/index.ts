//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IApprovalProvider, IApprovalProviderCreateOptions } from './approvalProvider';
import { TeamJoinApprovalProvider } from './teamJoinApprovalProvider';

export async function createAndInitializeApprovalProviderInstance(
  options: IApprovalProviderCreateOptions
): Promise<IApprovalProvider> {
  const provider = new TeamJoinApprovalProvider(options);
  await provider.initialize();
  return provider;
}
