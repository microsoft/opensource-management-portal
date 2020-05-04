//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "log", "dir"] }] */

// This migrates the schema for events to the newer Postgres schema. Kind of hacky.

import throat from 'throat';
import _ from 'lodash';

import app, { IReposJob } from '../../app';
import { PostgresPoolQueryAsync } from '../../lib/postgresHelpers';

app.runJob(async function go({ providers }: IReposJob) {
  let links = await providers.linkProvider.getAll();
  links = _.shuffle(links);
  let i = 0;

  const throttle = throat(4);
  await Promise.all(links.map(link => throttle(async () => {
    try {
      const r = await PostgresPoolQueryAsync(providers.postgresPool,
        `
          SELECT 
            entityid, 
            entitytype, 
            ((metadata->'created')) as jsoncreated,
            ((metadata->'additionaldata'->>'contribution')::boolean) as jsoncontribution,
            metadata
          FROM
            events 
          WHERE
            (metadata->>\'usercorporateid\') = $1 
          AND
            entitytype=$2
          AND 
          (
              created IS NULL 
           OR usercorporateid IS NULL 
           OR isopencontribution IS NULL
           OR action IS NULL
           OR inserted IS NULL
          )
          `, [
        link.corporateId,
        'event',
      ]);
      console.log(`${++i}/${links.length}\t\t${r && r.rows ? r.rows.length : ''}`);
      if (r && r.rows && r.rows.length) {
        console.log(link.corporateId + ': migrating ' + r.rows.length + ' rows');
        const innerThrottle = throat(5);
        await Promise.all(r.rows.map(row => innerThrottle(async () => {
          const { entityid, entitytype, jsoncreated, jsoncontribution, metadata } = row;
          const created = new Date(jsoncreated);
          if (true) {
            try {
              let parameter = 0;
              const newMetadata = {...metadata};
              await PostgresPoolQueryAsync(providers.postgresPool, `
                UPDATE
                  events
                SET
                  isopencontribution = $${++parameter},
                  created = $${++parameter},
                  usercorporateid = $${++parameter},
                  action = $${++parameter},
                  userusername = $${++parameter},
                  userid = $${++parameter},
                  usercorporateusername = $${++parameter},
                  organizationname = $${++parameter},
                  organizationid = $${++parameter},
                  repositoryname = $${++parameter},
                  repositoryid = $${++parameter},
                  inserted = $${++parameter},
                  updated =  $${++parameter}
                  -- metadata = ,
                WHERE
                  entityid=$${++parameter}
                AND
                  entitytype=$${++parameter}
                `, [
                  jsoncontribution,
                  created,
                  link.corporateId,
                  metadata.action,
                  metadata.userusername,
                  metadata.userid,
                  metadata.usercorporateusername,
                  metadata.organizationname,
                  metadata.organizationid,
                  metadata.repositoryname,
                  metadata.repositoryid,
                  new Date(metadata.inserted),
                  new Date(),
                  //newMetadata,
                  entityid,
                  entitytype,
                ]);
            } catch (xe) {
              console.log(xe);
              console.log()
            }
          }
        })));
      }
    } catch (error) {
      console.log(error.message);
      console.log();
    }
  })));
});
