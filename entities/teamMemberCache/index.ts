//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { ITeamMemberCacheProvider, ITeamMemberCacheCreateOptions, TeamMemberCacheProvider } from './teamMemberCacheProvider';
import { FixedQueryType, IEntityMetadataFixedQuery } from '../../lib/entityMetadataProvider/query';

export async function CreateTeamMemberCacheProviderInstance(options?: ITeamMemberCacheCreateOptions): Promise<ITeamMemberCacheProvider> {
  const provider = new TeamMemberCacheProvider(options);
  await provider.initialize();
  return provider;
}

export class TeamMemberCacheFixedQueryAll implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.TeamMemberCacheGetAll;
}

export class TeamMemberCacheFixedQueryByOrganizationId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.TeamMemberCacheGetByOrganizationId;
  constructor(public organizationId: string) {
    if (typeof(this.organizationId) !== 'string') {
      throw new Error(`${organizationId} must be a string`);
    }
  }
}

export class TeamMemberCacheFixedQueryByTeamId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.TeamMemberCacheGetByTeamId;
  constructor(public teamId: string) {
    if (typeof(this.teamId) !== 'string') {
      throw new Error(`${teamId} must be a string`);
    }
  }
}

export class TeamMemberCacheFixedQueryByUserId implements IEntityMetadataFixedQuery {
  public readonly fixedQueryType: FixedQueryType = FixedQueryType.TeamMemberCacheGetByUserId;
  constructor(public userId: string) {
    if (typeof(this.userId) !== 'string') {
      throw new Error(`${userId} must be a string`);
    }
  }
}
