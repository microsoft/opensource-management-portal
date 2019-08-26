//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["dir", "log"] }] */

'use strict';

import moment from 'moment';

interface IAuditDocument
{
  pk: string;
  type: string;
  provider: string;
  service: string;
  id: string;
  action: string;
  event: string;
  actor: any;
  scope?: string;
  membership?: any;
  member?: any;
  team?: any;
  changes?: any;
  organization?: any;
  timestamp?: any;
  repository?: any;
}

interface ICreatedDocument
{
  _self?: string;
}

const eventTypes = new Set([
  'membership',
  'member',
  'organization',
  'repository',
  'team',
]);

async function saveDocument(client, collection, document: IAuditDocument) {
  return new Promise(function (resolve, reject) {
    client.createDocument(collection._self, document, (createError, docInfo) => {
      if (createError) {
        return reject(createError);
      }
      return resolve(docInfo);
    });
  });
}

async function getCollection(client, database, name) {
  return new Promise(function (resolve, reject) {
    const link = `/dbs/${database.id}/${database._colls}${name}`;
    client.readCollection(link, (error, col) => {
      if (error) {
        return reject(error);
      }
      return resolve(col);
    });
  });
}

async function runAsync(operations, organization, data) {
  const cosmos = operations.providers.cosmosdb;

  const properties = data.properties;
  const body = data.body;

  const collectionName = cosmos.colNameTemp;
  const collection = await getCollection(cosmos.client, cosmos.database, collectionName);

  const partition = moment().utc().format('MMDD');

  const document : IAuditDocument = {
    pk: partition, // we always set the partitionKey for now
    type: 'event',
    provider: 'github',
    service: 'repos',
    id: properties.delivery,
    action: body.action,
    event: properties.event,
    actor: {
      id: body.sender.id,
      login: body.sender.login,
    },
  };

  if (body.scope) {
    document.scope = body.scope;
  }

  if (body.membership) {
    document.membership = {
      state: body.membership.state,
      role: body.membership.role,
      user: {
        id: body.membership.user.id,
        login: body.membership.user.login,
      },
    };
  }

  if (body.member) {
    document.member = {
      id: body.member.id,
      login: body.member.login,
    };
  }

  if (body.team) {
    document.team = {
      id: body.team.id,
      name: body.team.name,
    };
  }

  if (body.changes) {
    document.changes = body.changes;
  }

  document.timestamp = properties.started;

  if (body.organization) {
    document.organization = {
      id: body.organization.id,
      login: body.organization.login,
    };
  }

  if (body.repository) {
    document.repository = {
      id: body.repository.id,
      name: body.repository.name,
    };
  }

  return await saveDocument(cosmos.client, collection, document);
}

module.exports = {
  filter: function (data) {
    let eventType = data.properties.event;
    console.log(eventType);
    // console.dir(data);
    return eventTypes.has(eventType);
  },
  run: function (operations, organization, data, callback) {
    if (!operations.providers.cosmosdb) {
      return callback();
    }

    runAsync(operations, organization, data)
      .then((result) => {
        console.log((result as ICreatedDocument)._self);
        callback();
      })
      .catch(error => {
        return callback(error);
      });
  },
};
