//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ICorporateLink, IDictionary } from '.';
import { IGraphEntryWithManager } from '../lib/graphProvider';

export interface IUnlinkMailStatus {
  to: string[];
  bcc: string[];
  receipt: string;
}

export enum SupportedLinkType {
  User = 'user',
  ServiceAccount = 'serviceAccount',
}

export interface ISupportedLinkTypeOutcome {
  type: SupportedLinkType;
  graphEntry: IGraphEntryWithManager;
}

export enum UnlinkPurpose {
  Unknown = 'unknown',
  Termination = 'termination', // no longer listed as an employee
  Self = 'self', // the user self-service unlink themselves
  Operations = 'operations', // operational support
  Deleted = 'deleted', // the GitHub account has been deleted or does not exist
}

export enum LinkOperationSource {
  Portal = 'portal',
  Api = 'api',
}

export interface ICreateLinkOptions {
  link: ICorporateLink;
  operationSource: LinkOperationSource;
  skipCorporateValidation?: boolean;
  skipGitHubValidation?: boolean;
  skipSendingMail?: boolean;
  eventProperties?: IDictionary<string>;
  correlationId?: string;
}

export interface ICreatedLinkOutcome {
  linkId: string;
  resourceLink?: string;
}

export interface ICrossOrganizationMembershipBasics {
  id: string;
  login: string;
  avatar_url: string;
}

export interface ICrossOrganizationMembershipByOrganization {
  id: number; // ?
  orgs?: ICrossOrganizationMembershipBasics[]; // TODO: WARNING: This typing is incorrect. The object properties are the org name.
}

export interface IPromisedLinks {
  headers: {
    type: 'links';
  };
  data: ICorporateLink[];
}
