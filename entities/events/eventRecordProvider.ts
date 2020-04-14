//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { IEntityMetadata, EntityMetadataBase, IEntityMetadataBaseOptions } from '../../lib/entityMetadataProvider/entityMetadata';
import { EventRecord, EventRecordQueryContributionEventsByDateRange, EventRecordQueryContributionEventsByDateRangeAndId, EventRecordQueryContributionEventsByThirdPartyId, EventRecordDistinctOrganizations, EventRecordQueryRecordEligibleContributorsByRange, EventRecordPopularContributionsByRange } from './eventRecord';
import { EntityImplementation } from './eventRecord';

const thisProviderType = EntityImplementation.Type;

export interface IEventRecordProviderCreateOptions extends IEntityMetadataBaseOptions {
}

export interface IEventRecordProvider {
  initialize(): Promise<void>;
  getEvent(recordId: string): Promise<EventRecord>;
  insertEvent(record: EventRecord): Promise<string>;
  rewriteEvent(record: EventRecord): Promise<void>;

  queryEventsByThirdPartyId(thirdPartyId: string): Promise<EventRecord[]>;
  queryOpenContributionEventsByDateRange(startDate: Date, endDate: Date): Promise<EventRecord[]>;
  queryOpenContributionEventsByDateRangeAndThirdPartyId(thirdPartyId: string, startDate: Date, endDate: Date, limitToOpenContributionsOnly: boolean): Promise<EventRecord[]>;
  queryDistinctEligibleContributors(startDate: Date, endDate: Date): Promise<string[]>;
  queryDistinctOrganizations(): Promise<string[]>;
  queryPopularContributions(startDate: Date, endDate: Date): Promise<any[]>;
}

export class EventRecordProvider extends EntityMetadataBase implements IEventRecordProvider {
  constructor(options: IEventRecordProviderCreateOptions) {
    super(options);
    EntityImplementation.EnsureDefinitions();
  }

  async rewriteEvent(metadata: EventRecord): Promise<void> {
    const entity = this.serialize(thisProviderType, metadata);
    await this._entities.updateMetadata(entity);
  }

  async getEvent(eventId: string): Promise<EventRecord> {
    this.ensureHelpers(thisProviderType);
    let metadata: IEntityMetadata = null;
    metadata = await this._entities.getMetadata(thisProviderType, eventId);
    return this.deserialize<EventRecord>(thisProviderType, metadata);
  }

  async insertEvent(record: EventRecord): Promise<string> {
    const entity = this.serialize(thisProviderType, record);
    await this._entities.setMetadata(entity);
    return entity.entityId;
  }

  async queryEventsByThirdPartyId(thirdPartyId: string): Promise<EventRecord[]> {
    const query = new EventRecordQueryContributionEventsByThirdPartyId(thirdPartyId);
    const metadatas = await this._entities.fixedQueryMetadata(thisProviderType, query);
    const results = this.deserializeArray<EventRecord>(thisProviderType, metadatas);
    return results;
  }

  async queryOpenContributionEventsByDateRange(startDate: Date, endDate: Date): Promise<EventRecord[]> {
    const query = new EventRecordQueryContributionEventsByDateRange(startDate, endDate);
    const metadatas = await this._entities.fixedQueryMetadata(thisProviderType, query);
    const results = this.deserializeArray<EventRecord>(thisProviderType, metadatas);
    return results;
  }

  async queryOpenContributionEventsByDateRangeAndThirdPartyId(thirdPartyId: string, startDate: Date, endDate: Date, limitToOpenContributionsOnly: boolean): Promise<EventRecord[]> {
    const query = new EventRecordQueryContributionEventsByDateRangeAndId(startDate, endDate, thirdPartyId, limitToOpenContributionsOnly);
    const metadatas = await this._entities.fixedQueryMetadata(thisProviderType, query);
    const results = this.deserializeArray<EventRecord>(thisProviderType, metadatas);
    return results;
  }

  async queryDistinctEligibleContributors(startDate: Date, endDate: Date): Promise<string[]> {
    const query = new EventRecordQueryRecordEligibleContributorsByRange(startDate, endDate);
    const results = await this._entities.fixedQueryMetadata(thisProviderType, query);
    return results.map(row => row['userid']);
  }

  async queryPopularContributions(startDate: Date, endDate: Date): Promise<any[]> {
    const query = new EventRecordPopularContributionsByRange(startDate, endDate);
    const results = await this._entities.fixedQueryMetadata(thisProviderType, query);
    return results as any[];
  }

  async queryDistinctOrganizations(): Promise<string[]> {
    const query = new EventRecordDistinctOrganizations();
    const results = await this._entities.fixedQueryMetadata(thisProviderType, query);
    return results.map(row => row['orgname']);
  }
}
