//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { IApprovalProvider, IApprovalProviderCreateOptions } from '../../entities/teamJoinApproval/approvalProvider';
import { TeamJoinApprovalProvider } from '../../entities/teamJoinApproval/teamJoinApprovalProvider';

export async function createAndInitializeApprovalProviderInstance(options: IApprovalProviderCreateOptions): Promise<IApprovalProvider> {
  const provider = new TeamJoinApprovalProvider(options);
  await provider.initialize();
  return provider;
}
