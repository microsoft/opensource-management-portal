//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export interface ICorporateContactInformation {
  openSourceContact?: string;
  primaryLegalContact?: string;
  secondaryLegalContact?: string;
  highRiskBusinessReviewer?: string;
  lowRiskBusinessReviewer?: string;
  managerUsername?: string;
  managerDisplayName?: string;
  alias?: string;
  emailAddress?: string;
  legal?: string;
}

export interface ICorporateContactProvider {
  lookupContacts(corporateUsername: string): Promise<ICorporateContactInformation>;
  getBulkCachedContacts(): Promise<Map<string, ICorporateContactInformation | boolean>>;
  setBulkCachedContacts(map: Map<string, ICorporateContactInformation | boolean>): Promise<void>;
}
