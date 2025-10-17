//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ICorporateLink, IProviders, RequestTeamMemberAddType } from '../index.js';
import { OrganizationMember, type CrossOrganizationMembersResult, TeamMember } from '../../business/index.js';

export interface IMemberSearchOptions {
  providers: IProviders;

  organizationMembers?: OrganizationMember[];
  crossOrganizationMembers?: CrossOrganizationMembersResult;

  isOrganizationScoped?: boolean;
  links?: ICorporateLink[];
  pageSize?: number;
  phrase?: string;
  type?: string; // TODO: should be an enum eventually
  orgId?: string | number;
  team2AddType?: RequestTeamMemberAddType;
  teamMembers?: TeamMember[];
}
