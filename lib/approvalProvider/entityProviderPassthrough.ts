//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { IProviders } from '../../transitional';
import { IApprovalProvider } from './approvalProvider';
import {
  IEntityMetadataProvider,
  IEntityMetadataFixedQuery,
  FixedQueryType,
  EntityMetadataFixedQueryByTeam,
  EntityMetadataFixedQueryByThirdPartyUserId,
  EntityMetadataFixedQueryByTeams } from '../entityMetadataProvider/entityMetadataProvider';
import { EntityMetadataType } from '../entityMetadataProvider/entityMetadata';

module.exports = function createProvider(providers: IProviders, config) {
  const noOpOptions = {};
  const entityMetadataProvider = providers.entityMetadata;
  if (!entityMetadataProvider) {
    throw new Error('No entityMetadata provider configured for approval passthrough');
  }
  return new PassthroughApprovalProvider(providers, noOpOptions);
};

export class PassthroughApprovalProvider implements IApprovalProvider {
  private _entities: IEntityMetadataProvider;

  constructor(providers: IProviders, options: any) {
    this._entities = providers.entityMetadata;
  }

  async initialize(): Promise<void> {
  }

  async getApprovalEntity(approvalId: string): Promise<any> {
    return await this._entities.getMetadata(EntityMetadataType.TeamJoinRequest, approvalId);
  }

  async queryPendingApprovalsForTeam(id: string): Promise<any[]> {
    const query = new EntityMetadataFixedQueryByTeam(id);
    const result = await this._entities.fixedQueryMetadata(EntityMetadataType.TeamJoinRequest, query);
    throw new Error('Method not implemented.');
  }

  async queryPendingApprovalsForTeams(ids: string[]): Promise<any[]> {
    const query = new EntityMetadataFixedQueryByTeams(ids);
    const result = await this._entities.fixedQueryMetadata(EntityMetadataType.TeamJoinRequest, query);
    throw new Error('Method not implemented.');
  }

  async queryPendingApprovalsForThirdPartyId(thirdPartyId: string): Promise<any[]> {
    const query = new EntityMetadataFixedQueryByThirdPartyUserId(thirdPartyId);
    const result = await this._entities.fixedQueryMetadata(EntityMetadataType.TeamJoinRequest, query);
    throw new Error('Method not implemented.');
  }
}
