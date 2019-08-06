//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const _ = require('lodash');

import { v4 as uuidV4 } from 'uuid';
import { IReposError } from '../../../transitional';
import { ILinkProvider } from '../postgres/postgresLinkProvider';
import { ICorporateLinkProperties, ICorporateLink, ICorporateLinkExtended, CorporatePropertyNames } from '../../../business/corporateLink';

import { CorporateMemoryLink } from './memoryLink';

const defaultThirdPartyType = 'github';
const defaultPageSize = 500;

const linkProviderInstantiationTypeProperty = '_i';
const dehydratedIdentityKey = '_lpi';
const dehydratedMemoryProviderName = 'mem';
const dehydratedMemoryProviderVersion = '0';
const dehydratedMemoryProviderIdentitySeperator = '_';
const dehydratedMemoryProviderIdentity = `${dehydratedMemoryProviderName}${dehydratedMemoryProviderIdentitySeperator}${dehydratedMemoryProviderVersion}`;

enum LinkInstantiatedType {
  MemoryEntity,
  Rehydrated,
}

interface IAlreadyLinkedError extends IReposError {
  alreadyLinked?: boolean;
}

export interface IMemoryLinkProperties extends ICorporateLinkProperties {
  // these have more explicit names to help track down bugs when using extended links
  memoryLinkId: string;
}

const linkInterfacePropertyMapping : IMemoryLinkProperties = {
  memoryLinkId: 'memoryLinkId',

  isServiceAccount: 'serviceAccount',
  serviceAccountMail: 'serviceAccountMail',

  corporateId: 'aadoid',
  corporateUsername: 'aadupn',
  corporateDisplayName: 'aadname',

  thirdPartyId: 'ghid',
  thirdPartyUsername: 'ghu',
  thirdPartyAvatar: 'ghavatar',
};

export class MemoryLinkProvider implements ILinkProvider {
  // maps link ID to a simple object entity - NOT an actual CorporateMemoryLink. This is to help fight bugs in the wrapped and provider-aware link design
  private _entities: Map<string, any>;

  private _options: any;
  private _thirdPartyType: string;

  public readonly propertyMapping: IMemoryLinkProperties = linkInterfacePropertyMapping;

  public readonly serializationIdentifierVersion: string = dehydratedMemoryProviderIdentity;

  constructor(providers, options) {
    if (!providers) {
      throw new Error('The MemoryLinkProvider requires that available providers are passed into the constructor');
    }

    options = options || {};

    const thirdPartyType = options.thirdPartyType || defaultThirdPartyType;
    if (thirdPartyType !== 'github') {
      throw new Error('At this time only "github" is a supported third-party type.');
    }

    this._options = options;
  }

  initialize(callback) {
    this._entities = new Map();

    return callback();
  }

  get thirdPartyType() {
    return this._thirdPartyType;
  }

  getByThirdPartyUsername(username, callback) {
    username = username.toLowerCase();
    return getSingleLinkByProperty(this, this.propertyMapping.thirdPartyUsername, username, callback);
  }

  getByThirdPartyId(id, callback) {
    if (typeof(id) !== 'string') {
      id = id.toString();
    }
    return getSingleLinkByProperty(this, this.propertyMapping.thirdPartyId, id, callback);
  }

  queryByCorporateId(id, callback) {
    return getLinksByProperty(this, this.propertyMapping.corporateId, id, callback);
  }

  getAll(callback) {
    const all = Array.from(this._entities.values());
    const sorted = _.sortBy(all, [this.propertyMapping.corporateUsername, this.propertyMapping.thirdPartyUsername]);
    const links = createLinkInstancesFromMemoryEntityArray(this, sorted);
    return callback(null, links);
  }

  queryByCorporateUsername(username, callback) {
    username = username.toLowerCase();
    return getLinksByProperty(this, this.propertyMapping.corporateUsername, username, callback);
  }

  createLink(link: ICorporateLink, callback: (error: any, newLinkId: string) => void) {
    const generatedLinkId = uuidV4();
    const initialEntity = {};
    initialEntity[linkInterfacePropertyMapping.memoryLinkId] = generatedLinkId;

    for (let linkPropertyName of CorporatePropertyNames) {
      const tableColumnName = linkInterfacePropertyMapping[linkPropertyName];
      if (!tableColumnName) {
        return callback(new Error(`Missing mapping from property ${linkPropertyName} to equivalent key`), null);
      }
      initialEntity[tableColumnName] = link[linkPropertyName];
    }

    if (this._entities.has(generatedLinkId)) {
      const error: IAlreadyLinkedError = new Error('This link already exists');
      return callback(error, null);
    }

    this._entities.set(generatedLinkId, initialEntity);
    return callback(null, generatedLinkId);
  }

  updateLink(linkInstance: ICorporateLink, callback) {
    const tl = linkInstance as CorporateMemoryLink;
    const replacementEntity = tl.internal().getDirectEntity();
    const linkId = tl.id;
    if (!this._entities.has(linkId)) {
      return callback(new Error(`No existing entity with link ID ${linkId}`));
    }
    this._entities.set(linkId, replacementEntity);
    return callback();
  }

  deleteLink(linkInstance: ICorporateLink, callback) {
    // This is inefficient at this time; with the newer design centering
    // around a link ID, this has to query first.
    const tl = linkInstance as CorporateMemoryLink;
    return getSingleLinkByProperty(this, this.propertyMapping.memoryLinkId, tl.id, (queryError, link: ICorporateLink) => {
      if (!queryError && !link) {
        queryError = new Error(`No link found with ID ${tl.id}`);
      }
      this._entities.delete(tl.id);
      return callback();
    });
  }

  dehydrateLink(linkInstance: ICorporateLinkExtended): any {
    // CONSIDER: check whether the current link type feels appropriate to us (PGSQL)
    const tlink = linkInstance as CorporateMemoryLink;
    const entity = tlink.internal().getDirectEntity();
    const shriveled = Object.assign({}, entity);
    shriveled[dehydratedIdentityKey] = dehydratedMemoryProviderIdentity;
    return shriveled;
  }

  rehydrateLink(jsonObject: any): ICorporateLink {
    if (!jsonObject) {
      throw new Error('No object provided to rehydrate');
    }
    const identity = jsonObject[dehydratedIdentityKey] as string;
    if (!identity) {
      throw new Error('No stored link provider identity to validate');
    }
    if (identity !== dehydratedMemoryProviderIdentity) {
      const sameProviderType = identity.startsWith(`${dehydratedMemoryProviderName}${dehydratedMemoryProviderIdentitySeperator}`);
      if (sameProviderType) {
        // Cross-version rehydration not supported
        throw new Error(`The hydrated link was created by the same ${dehydratedMemoryProviderName} provider, but a different version: ${identity}`);
      } else {
        throw new Error(`The hydrated link is incompatible with this runtime environment: ${identity}`);
      }
    }
    const clonedObject = Object.assign({}, jsonObject);
    delete clonedObject[dehydratedIdentityKey];
    const pglink = createLinkInstanceFromHydratedEntity(this, clonedObject);
    return pglink;
  }

  dehydrateLinks(linkInstances: ICorporateLink[]): any[] {
    if (!Array.isArray(linkInstances)) {
      throw new Error('linkInstances must be an array');
    }
    if (linkInstances.length > 0) {
      const first = linkInstances[0];
      if (first[linkProviderInstantiationTypeProperty] === undefined) {
        throw new Error('linkInstances[0] does not appear to be a link instantiated by a provider');
      }
    }
    //
    const arr: any[] = linkInstances.map(this.dehydrateLink.bind(this));
    return arr;
  }

  rehydrateLinks(jsonArray: any): ICorporateLink[] {
    if (!Array.isArray(jsonArray)) {
      throw new Error('jsonArray must be an array');
    }
    //
    const arr = jsonArray.map(this.rehydrateLink.bind(this));
    return arr as any[] as ICorporateLink[];
  }
}

function createLinkInstancesFromMemoryEntityArray(provider: MemoryLinkProvider, rows: any[]) {
  return rows.map(createLinkInstanceFromMemoryEntity.bind(null, provider));
}

function createLinkInstanceFromMemoryEntity(provider: MemoryLinkProvider, row: any): CorporateMemoryLink {
  const linkInternalOptions = {
    provider,
  };
  const newLink = new CorporateMemoryLink(linkInternalOptions, row);
  newLink[linkProviderInstantiationTypeProperty] = LinkInstantiatedType.MemoryEntity; // in case this helps while debugging
  return newLink;
}

function createLinkInstanceFromHydratedEntity(self, jsonObject) {
  const linkInternalOptions = {
    provider: self,
  };
  const newLink = new CorporateMemoryLink(linkInternalOptions, jsonObject);
  newLink[linkProviderInstantiationTypeProperty] = LinkInstantiatedType.Rehydrated; // in case this helps while debugging
  return newLink;
}

function getUserEntitiesByProperty(entities: Map<string, CorporateMemoryLink>, propertyName: string, value: string, callback) {
  const rows: CorporateMemoryLink[] = [];
  entities.forEach(entry => {
    if (entry && entry[propertyName] === value) {
      rows.push(entry);
    }
  });
  return callback(null, rows);
}

function getLinksByProperty(self, propertyName, value, callback) {
  return getUserEntitiesByProperty(self._entities, propertyName, value, (error, rows) => {
    if (error) {
      return callback(error);
    }
    const links = createLinkInstancesFromMemoryEntityArray(self, rows);
    return callback(null, links);
  });
}

function getSingleLinkByProperty(self, propertyName, value, callback) {
  return getUserEntitiesByProperty(self._entities, propertyName, value, (getError, rows) => {
    if (getError) {
      return callback(getError);
    }
    if (rows.length <= 0) {
      return callback(null, false);
    }
    if (rows.length > 1) {
      const error: Error = new Error(`More than a single result were returned by the query (${rows.length})`);
      error['multipleResults'] = rows.length;
      return callback(error);
    }
    const entityRow = rows[0];
    const link = createLinkInstanceFromMemoryEntity(self, entityRow);
    return callback(null, link);
  });
}
