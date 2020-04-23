//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/*eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

// This is a transition migration job that takes a specific entity metadata provider
// implementation (including serialization/deserialization) and can be used to move
// and validate data between stores.

const circuitBreakerOverrideClearingDestination = process.env.CIRCUIT_BREAKER_OVERRIDE === 'migrate-data-clear-ok';

import throat from 'throat';

import app, { IReposJob } from '../../app';
import { IProviders } from '../../transitional';
import { createAndInitializeEntityMetadataProviderInstance, IEntityMetadataProvidersOptions } from '../../lib/entityMetadataProvider';
import { createAndInitializeRepositoryMetadataProviderInstance } from '../../entities/repositoryMetadata';
import { RepositoryMetadataEntity } from '../../entities/repositoryMetadata/repositoryMetadata';
import { TeamJoinApprovalEntity } from '../../entities/teamJoinApproval/teamJoinApproval';
import { createAndInitializeApprovalProviderInstance } from '../../entities/teamJoinApproval';

const parallelMigrations = 1;

export default async function migration({ providers }: IReposJob) : Promise<void> {
  const config = providers.config;
  const emOptions: IEntityMetadataProvidersOptions = {
    tableOptions: {
      account: config.github.links.table.account,
      key: config.github.links.table.key,
      prefix: config.github.links.table.prefix,
      encryption: {
        keyEncryptionKeyId: config.github.links.table.encryptionKeyId,
        keyResolver: providers.keyEncryptionKeyResolver,
      },
    },
    postgresOptions: {
      pool: providers.postgresPool,
    },
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

  console.log('Migrating: Repository Metadata');
  const sourceRepositoryMetadata = await sourceRepoMetadataProvider.queryAllRepositoryMetadatas();
  console.log(`migrating ${sourceRepositoryMetadata.length} metadata entries for repositories...`);

  // SCARY:
  const destinationMetadataEntries = await destinationRepoMetadataProvider.queryAllRepositoryMetadatas();
  console.log(`destination entries already: ${destinationMetadataEntries.length}`);
  const clearDestination = circuitBreakerOverrideClearingDestination;
  if (destinationMetadataEntries.length > 0 && !clearDestination) {
    throw new Error('Destination repo metadatas are not empty');
  }
  await destinationRepoMetadataProvider.clearAllRepositoryMetadatas();

  let errors = 0;
  let errorList = [];
  let i = 0;
  const throttle = throat(parallelMigrations);
  await Promise.all(sourceRepositoryMetadata.map((repo: RepositoryMetadataEntity) => throttle(async () => {
    try {
      console.log(`${i++}: Migrating: ${repo.repositoryId}: ${repo.organizationName}/${repo.repositoryName}`);
      await destinationRepoMetadataProvider.createRepositoryMetadata(stripAzureTableDataIfPresent(repo));
    } catch (migrationError) {
      console.log(`error with entry: ${repo.repositoryId}`);
      console.dir(migrationError);
      errorList.push(migrationError);
      ++errors;
      // throw migrationError;
    }
  })));

  console.log('All done with repo metadatas, ' + errors + ' errors');
  console.dir(errorList);
  console.log();

  errors = 0;
  errorList = [];

  console.log('Migrating: Team Requests Metadata');
  const sourceTeamJoinApprovals = await sourceTeamJoinApprovalProvider.queryAllApprovals();
  console.log(`migrating ${sourceTeamJoinApprovals.length} team join requests...`);

  // SCARY:
  const destinationTeamEntries = await destinationTeamJoinApprovalProvider.queryAllApprovals();
  console.log(`destination entries already: ${destinationMetadataEntries.length}`);
  const clearDestination2 = circuitBreakerOverrideClearingDestination;
  if (destinationTeamEntries.length > 0 && !clearDestination2) {
    throw new Error('Destination team joins are not empty');
  }
  await destinationTeamJoinApprovalProvider.deleteAllRequests();

  i = 0;
  await Promise.all(sourceTeamJoinApprovals.map((request: TeamJoinApprovalEntity) => throttle(async () => {
    try {
      console.log(`${i++}: Migrating: ${request.approvalId} by ${request.thirdPartyUsername}`);
      await destinationTeamJoinApprovalProvider.createTeamJoinApprovalEntity(stripAzureTableDataIfPresent(request));
    } catch (migrationError) {
      console.dir(migrationError);
      // throw migrationError;
      ++errors;
      errorList.push(migrationError);
    }
    return '';
  })));

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
