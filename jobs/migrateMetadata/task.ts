//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

// This is a transition migration job that takes a specific entity metadata provider
// implementation (including serialization/deserialization) and can be used to move
// and validate data between stores.

// Also requires migration environment variables:
// METADATA_MIGRATION_SOURCE_TYPE
// METADATA_MIGRATION_DESTINATION_TYPE
// METADATA_MIGRATION_OVERWRITE  values : 'overwrite', 'skip'

'use strict';

import throat = require('throat');

import { IProviders } from '../../transitional';

import { createAndInitializeEntityMetadataProviderInstance, IEntityMetadataProvidersOptions } from '../../lib/entityMetadataProvider';
import { createAndInitializeRepositoryMetadataProviderInstance } from '../../entities/repositoryMetadata';
import { RepositoryMetadataEntity } from '../../entities/repositoryMetadata/repositoryMetadata';
import { TeamJoinApprovalEntity } from '../../entities/teamJoinApproval/teamJoinApproval';
import { createAndInitializeApprovalProviderInstance } from '../../entities/teamJoinApproval';

const parallelMigrations = 1;

module.exports = function run(config) {
  const app = require('../../app');
  config.skipModules = new Set([
    'web',
  ]);

  app.initializeApplication(config, null, error => {
    if (error) {
      throw error;
    }
    migration(config, app).then(done => {
      console.log('done');
      process.exit(0);
    }).catch(error => {
      console.dir(error);
      throw error;
    });
  });
};

async function migration(config, app) : Promise<void> {
  const providers = app.settings.providers as IProviders;

  const emOptions: IEntityMetadataProvidersOptions = {
    tableOptions: null,
    postgresOptions: null,
  };
  const sourceOverrideType = 'table';
  const sourceEntityMetadataProvider = await createAndInitializeEntityMetadataProviderInstance(
    app,
    config,
    emOptions,
    sourceOverrideType);
  const destinationOverrideType = 'postgres';
    const destinationEntityMetadataProvider = await createAndInitializeEntityMetadataProviderInstance(
    app,
    config,
    emOptions,
    destinationOverrideType);

  const sourceTeamJoinApprovalProvider = await createAndInitializeApprovalProviderInstance({ entityMetadataProvider: sourceEntityMetadataProvider });
  const sourceRepoMetadataProvider = await createAndInitializeRepositoryMetadataProviderInstance({ entityMetadataProvider: sourceEntityMetadataProvider });

  const destinationTeamJoinApprovalProvider = await createAndInitializeApprovalProviderInstance({ entityMetadataProvider: destinationEntityMetadataProvider });
  const destinationRepoMetadataProvider = await createAndInitializeRepositoryMetadataProviderInstance({ entityMetadataProvider: destinationEntityMetadataProvider });

  // SCARY:
  await destinationRepoMetadataProvider.clearAllRepositoryMetadatas();

  console.log('Migrating: Repository Metadata');
  const sourceRepositoryMetadata = await sourceRepoMetadataProvider.queryAllRepositoryMetadatas();
  console.log(`migrating ${sourceRepositoryMetadata.length} metadata entries for repositories...`);
  let errors = 0;
  let errorList = [];
  let i = 0;
  await Promise.all(sourceRepositoryMetadata.map(throat<string, (r: RepositoryMetadataEntity) => Promise<string>>(async repo => {
    try {
      console.log(`${i++}: Migrating: ${repo.repositoryId}: ${repo.organizationName}/${repo.repositoryName}`);
      await destinationRepoMetadataProvider.createRepositoryMetadata(stripAzureTableDataIfPresent(repo));
    } catch (migrationError) {
      console.dir(migrationError);
      throw migrationError;
    }
    return '';
  }, parallelMigrations)));

  console.log('All done with repo metadatas, ' + errors + ' errors');
  console.dir(errorList);
  console.log();

  errors = 0;
  errorList = [];

  // SCARY:
  await destinationTeamJoinApprovalProvider.deleteAllRequests();

  console.log('Migrating: Team Requests Metadata');
  const sourceTeamJoinApprovals = await sourceTeamJoinApprovalProvider.queryAllApprovals();
  console.log(`migrating ${sourceTeamJoinApprovals.length} team join requests...`);
  i = 0;
  await Promise.all(sourceTeamJoinApprovals.map(throat<string, (tj: TeamJoinApprovalEntity) => Promise<string>>(async request => {
    try {
      console.log(`${i++}: Migrating: ${request.approvalId} by ${request.thirdPartyUsername}`);
      await destinationTeamJoinApprovalProvider.createTeamJoinApprovalEntity(stripAzureTableDataIfPresent(request));
    } catch (migrationError) {
      console.dir(migrationError);
      throw migrationError;
    }
    return '';
  }, parallelMigrations)));

  console.log('All done with requests, ' + errors + ' errors');
  console.dir(errorList);
  console.log();
}

function stripAzureTableDataIfPresent(obj: any) {
  if (obj.azureTableRowKey) {
    delete obj.azureTableRowKey;
  }
  return obj;
}
