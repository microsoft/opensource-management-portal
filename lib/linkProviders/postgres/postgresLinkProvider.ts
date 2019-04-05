//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// need to determine how to setup the table/s initially

// from the cosmosdb fork provider:
// Provides a one-to-many mapping of links, where a single third-party username is
// associated with at most one corporate identity. A corporate identity may be associated
// with multiple third-party identities. The instance of the provider is able to also
// take in an optional name/identifier for the type of third-party, though the default
// assumed provider type is 'github' for the purposes of this implementation.

// An ideal provider provides a thin business-oriented wrapper over the data layer
// free of any caching or other logic. A provider may require additional options or
// capabilities through the 'options' constructor object to provide specific goals
// or capabilities.

// It is assumed that a link have a unique identifier, whether constructed or passed
// through the data layer, that can uniquely refer to a link for key operations.

'use strict';

const onlySupportedThirdPartyType = 'github';

import { v4 as uuidV4 } from 'uuid';
import { InnerError } from "../../../transitional";

import { ICorporateLinkProperties, ICorporateLink, ICorporateLinkExtended } from "../../../business/corporateLink";

import { CorporateLinkPostgres } from './postgresLink';

const linkProviderInstantiationTypeProperty = '_i';

const dehydratedIdentityKey = '_lpi';
const dehydratedPostgresProviderName = 'pg';
const dehydratedPostgresProviderVersion = '0';
const dehydratedPostgresProviderIdentitySeperator = '_';
const dehydratedPostgresProviderIdentity = `${dehydratedPostgresProviderName}${dehydratedPostgresProviderIdentitySeperator}${dehydratedPostgresProviderVersion}`;

enum LinkInstantiatedType {
  Row,
  Rehydrated,
}

export interface IPostgresLinkProperties extends ICorporateLinkProperties {
  linkId: string;
  created: string;
}

const linkInterfacePropertyMapping : IPostgresLinkProperties = {
  thirdPartyId: 'thirdpartyid',
  thirdPartyUsername: 'thirdpartyusername',
  thirdPartyAvatar: 'thirdpartyavatar',
  corporateId: 'corporateid',
  corporateUsername: 'corporateusername',
  corporateDisplayName: 'corporatename',
  isServiceAccount: 'serviceaccount',
  serviceAccountMail: 'serviceaccountmail',

  // specific to this type
  linkId: 'linkid',
  created: 'created',
};

const coreColumns = [
  'linkid',
  'thirdpartyid',
  'thirdpartyusername',
  'thirdpartyavatar',
  'corporateid',
  'corporateusername',
  'corporatename',
  'serviceaccount',
  'serviceaccountmail',
  'created',
];
const coreColumnsList = coreColumns.join(', ');

// should move out of the postgres-specific page...
export interface ILinkProvider {
  initialize(callback);

  thirdPartyType: string;

  getByThirdPartyUsername(username: string, callback);
  getByThirdPartyId(id: string, callback);
  queryByCorporateId(id: string, callback);
  queryByCorporateUsername(username: string, callback);
  getAll(callback);

  createLink(link: ICorporateLink, callback: (error: any, newLinkId: string) => void): void;
  updateLink(linkInstance: ICorporateLink, callback);
  deleteLink(linkInstance: ICorporateLink, callback);

  dehydrateLink(linkInstance: ICorporateLinkExtended): any;
  rehydrateLink(jsonObject: any): ICorporateLink;
  dehydrateLinks(linkInstances: ICorporateLink[]): any[];
  rehydrateLinks(jsonArray: any): ICorporateLink[];
  serializationIdentifierVersion: string;
}

export class PostgresLinkProvider implements ILinkProvider {
  private _thirdPartyType: string;
  private _providers: any;
  private _pool: any;
  private _tableName: any;
  private _internalThirdPartyTypeValue: string;
  private _options: any;

  public readonly propertyMapping: IPostgresLinkProperties = linkInterfacePropertyMapping;

  public readonly serializationIdentifierVersion: string = dehydratedPostgresProviderIdentity;

  constructor(providers, options) {
    if (!providers) {
      throw new Error('The PostgresLinkProvider requires that available providers are passed into the constructor');
    }
    options = options || {};

    if (!options.tableName) {
      throw new Error('Missing the name of the table for links for the Postgres link provider');
    }

    const thirdPartyType = options.thirdPartyType || onlySupportedThirdPartyType;
    const internalThirdPartyTypeValue = options.thirdPartyTypeValue || (thirdPartyType === 'github' ? options.githubThirdPartyName: thirdPartyType);

    this._thirdPartyType = thirdPartyType;
    this._internalThirdPartyTypeValue = internalThirdPartyTypeValue;
    this._providers = providers;
    this._tableName = options.tableName;
    this._pool = providers.postgresPool;
    this._options = options;
  }

  initialize(callback) {
    const self = this;
    query(this, `
      SELECT
        COUNT(thirdpartyid) as thirdpartycount,
        COUNT(corporateid) as corporatecount
      FROM ${self._tableName}
      WHERE
        thirdpartytype = $1`, [
          self._internalThirdPartyTypeValue,
          ], function (error, results) {
            if (error) {
              return callback(error);
            }
            if (results.rows.length === 1) {
              const row = results.rows[0];
              console.log(`FYI: Postgres: there are ${row.thirdpartycount} third-party links to ${row.corporatecount} corporate users`);
            }
            return callback(null, self);
    });
  }

  get thirdPartyType() {
    return this._thirdPartyType;
  }

  getByPostgresLinkId(id, callback) {
    // Specific to this link provider implementation
    return this._getSingleRow({
      columnName: 'linkid',
      columnValue: id,
      columnIsLowercase: false,
    }, callback);
  }

  getByThirdPartyUsername(username, callback) {
    return this._getSingleRow({
      columnName: 'thirdpartyusername',
      columnValue: username,
      columnIsLowercase: true,
    }, callback);
  }

  getByThirdPartyId(id, callback) {
    return this._getSingleRow({
      columnName: 'thirdpartyid',
      columnValue: id,
      columnIsLowercase: false,
    }, callback);
  }

  queryByCorporateId(id, callback) {
    return this._getRows({
      columnName: 'corporateid',
      columnValue: id,
      columnIsLowercase: false,
    }, callback);
  }

  getAll(callback) {
    const self = this;
    const internalThirdPartyTypeValue = this._internalThirdPartyTypeValue;
    // CONSIDER: the table provider sorts by aadupn and then ghu!
    // TODO: is an order by of interest here?
    query(self, `
      SELECT
        ${coreColumnsList}
      FROM ${this._tableName}
      WHERE
        thirdpartytype = $1
    `, [
      internalThirdPartyTypeValue,
    ],
    function (error, results) {
      if (error) {
        return callback(error);
      }
      let r = [];
      for (let i = 0; i < results.rows.length; i++) {
        const row = results.rows[i];
        const link = createLinkInstanceFromRow(self, row);
        const ll = link;
        r.push(ll);
      }
      return callback(null, r);
    });
  }

  queryByCorporateUsername(username, callback) {
    return this._getRows({
      columnName: 'corporateusername',
      columnValue: username,
      columnIsLowercase: true,
    }, callback);
  }

  createLink(link: ICorporateLink, callback) {
    const self = this;
    const linkId = uuidV4(); // primary key protected
    if (!link.thirdPartyId || !link.thirdPartyUsername || !link.corporateId || !link.corporateUsername) {
      return callback(new Error('Missing a required value'));
    }
    const created = new Date();
    query(self, `
      INSERT INTO ${this._tableName}(
        linkid,
        thirdpartytype,
        thirdpartyid, thirdpartyusername, thirdpartyavatar,
        corporateid, corporateusername, corporatename,
        serviceaccount, serviceaccountmail,
        created)
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
    `, [
      linkId,
      self._internalThirdPartyTypeValue,
      link.thirdPartyId, link.thirdPartyUsername, link.thirdPartyAvatar,
      link.corporateId, link.corporateUsername, link.corporateDisplayName,
      link.isServiceAccount, link.serviceAccountMail,
      created,
    ],
    function (error, insertResult) {
      if (error && error.message && error.message.includes('duplicate key value')) {
        const ie : InnerError = new Error('A link already exists for the identity');
        ie.inner = error;
        error = ie;
      }
      return callback(error ? error : null, error ? null : linkId);
    });
  }

  updateLink(linkInstance: ICorporateLink, callback) {
    const self = this;
    const pgl = linkInstance as CorporateLinkPostgres;
    const id = pgl.id;
    const values = [ id ];
    const internal = pgl.internal();
    const updates = internal.getDirtyColumns();
    const columns = Object.getOwnPropertyNames(updates);
    if (columns.length === 0) {
      const noUpdatesRequired = new Error('No updates were required for the link');
      noUpdatesRequired['noUpdatesRequired'] = true;
      return callback(noUpdatesRequired);
    }
    const sets = columns.map(columnName => {
      values.push(updates[columnName]);
      const index = values.length;
      return `\n  ${columnName} = \$${index}`;
    }).join();
    let sql = `
      UPDATE ${this._tableName}
      SET ${sets}
      WHERE
        linkid = $1
    `;
    console.log(sql);
    console.dir(values);
    query(self, sql, values, function (error, results) {
      // TODO: how to validate updates?
      if (error) {
        return callback(error);
      }
      internal.acknowledgeSuccessfulUpdate();
      return callback(null, results.rowCount > 0 /* whether a row was actually updated */);
    });
  }

  deleteLink(link: ICorporateLink, callback) {
    const pgl = link as CorporateLinkPostgres;
    const id = pgl.id;
    return this._deleteSingleRow({ columnName: 'linkid', columnValue: id }, callback);
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

  rehydrateLinks(jsonArray: any[]): ICorporateLink[] {
    if (!Array.isArray(jsonArray)) {
      throw new Error('jsonArray must be an array');
    }
    //
    const arr = jsonArray.map(this.rehydrateLink.bind(this));
    return arr as any[] as ICorporateLink[];
  }

  dehydrateLink(linkInstance: ICorporateLinkExtended): any {
    // CONSIDER: check whether the current link type feels appropriate to us (PGSQL)
    const pglink = linkInstance as CorporateLinkPostgres;
    const entity = pglink.internal().getDirectEntity();
    const shriveled = Object.assign({}, entity);
    shriveled[dehydratedIdentityKey] = dehydratedPostgresProviderIdentity;
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
    if (identity !== dehydratedPostgresProviderIdentity) {
      const sameProviderType = identity.startsWith(`${dehydratedPostgresProviderName}${dehydratedPostgresProviderIdentitySeperator}`);
      if (sameProviderType) {
        // Cross-version rehydration not supported
        throw new Error(`The hydrated link was created by the same ${dehydratedPostgresProviderName} provider, but a different version: ${identity}`);
      } else {
        throw new Error(`The hydrated link is incompatible with this runtime environment: ${identity}`);
      }
    }
    const clonedObject = Object.assign({}, jsonObject);
    delete clonedObject[dehydratedIdentityKey];
    const pglink = createLinkInstanceFromHydratedEntity(this, clonedObject);
    return pglink;
  }

  private _getRows({columnName, columnValue, columnIsLowercase}, callback) {
    const self = this;
    let columnWrapperStart = columnIsLowercase ? 'lower(' : '';
    let columnWrapperFinish = columnIsLowercase ? ')' : '';
    query(self, `
      SELECT
        ${coreColumnsList}
      FROM ${this._tableName}
      WHERE
        thirdpartytype = $1 AND
        ${columnWrapperStart}${columnName}${columnWrapperFinish} = $2
    `, [
      self._internalThirdPartyTypeValue,
      columnIsLowercase ? columnValue.toLowerCase() : columnValue,
    ],
    function (error, results) {
      if (error) {
        return callback(error);
      }
      let r = [];
      for (let i = 0; i < results.rows.length; i++) {
        const row = results.rows[i];
        const link = createLinkInstanceFromRow(self, row);
        const ll = link;
        r.push(ll);
      }
      return callback(null, r);
    });
  }

  private _getSingleRow({columnName, columnValue, columnIsLowercase}, callback) {
    const self = this;
    let columnWrapperStart = columnIsLowercase ? 'lower(' : '';
    let columnWrapperFinish = columnIsLowercase ? ')' : '';
    query(self, `
      SELECT
        ${coreColumnsList}
      FROM ${this._tableName}
      WHERE
        thirdpartytype = $1 AND
        ${columnWrapperStart}${columnName}${columnWrapperFinish} = $2
    `, [
      self._internalThirdPartyTypeValue,
      columnIsLowercase ? columnValue.toLowerCase() : columnValue,
    ],
    function (error, results) {
      if (error) {
        return callback(error);
      }
      const len = results.rowCount;
      if (len === 1) {
        return callback(null, createLinkInstanceFromRow(self, results.rows[0]));
      } else if (len === 0) {
        const notFoundError = new Error('No link was found');
        notFoundError['status'] = 404;
        return callback(notFoundError);
      }
      return callback(new Error(`Only one row should be returned; ${len} rows were returned`));
    });
  }

  private _deleteSingleRow({columnName, columnValue}, callback) {
    const self = this;
    query(self, `
      DELETE
      FROM ${this._tableName}
      WHERE
        ${columnName} = $1
    `, [
      columnValue,
    ],
    function (error, deleteResult) {
      if (error) {
        return callback(error);
      }
      return callback(null, deleteResult.rowCount > 0);
    });
  }
}

function createLinkInstanceFromRow(self, row) {
  const linkInternalOptions = {
    provider: self,
  };
  const newLink = new CorporateLinkPostgres(linkInternalOptions, row);
  newLink[linkProviderInstantiationTypeProperty] = LinkInstantiatedType.Row; // in case this helps while debugging
  return newLink;
}

function createLinkInstanceFromHydratedEntity(self, jsonObject) {
  const linkInternalOptions = {
    provider: self,
  };
  const newLink = new CorporateLinkPostgres(linkInternalOptions, jsonObject);
  newLink[linkProviderInstantiationTypeProperty] = LinkInstantiatedType.Rehydrated; // in case this helps while debugging
  return newLink;
}

function query(self, sql, values, callback) {
  if (!callback && typeof(values) === 'function') {
    callback = values;
    values = [];
  }
  const pool = self._pool;
  pool.connect(function (connectError, client, release) {
    if (connectError) {
      return callback(connectError);
    }
    console.log(sql);
    console.dir(values);
    client.query(sql, values, function (queryError, results) {
      release();
      if (queryError) {
        const err: InnerError = new Error(queryError.message /* Postgres provider never leaks SQL statements thankfully */ || 'There was an error querying a database');
        err.inner = queryError;
        if (queryError.position) {
          err['position'] = queryError.position;
        }
        if (queryError.message) {
          err['sqlMessage'] = queryError.message;
          err['sqlStatement'] = sql;
          err['sqlValues'] = values;
        }
        return callback(err);
      }
      return callback(null, results);
    });
  });
}
