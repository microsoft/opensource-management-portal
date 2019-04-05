//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IProviders } from '../../transitional';

export interface IApprovalProvider {
  initialize(): Promise<void>;

  getApprovalEntity(approvalId: string): Promise<any>;
  queryPendingApprovalsForTeam(id: string): Promise<any[]>;
  queryPendingApprovalsForTeams(ids: string[]): Promise<any[]>;
  queryPendingApprovalsForThirdPartyId(thirdPartyId: string): Promise<any[]>;
}

export interface IApprovalProviderCreateOptions
{
  providers: IProviders;
  config: any;
  overrideProviderType?: string;
}
