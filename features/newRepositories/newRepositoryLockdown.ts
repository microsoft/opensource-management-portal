//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Operations, Organization, Repository } from '../../business';
import { IRepositoryMetadataProvider } from '../../entities/repositoryMetadata/repositoryMetadataProvider';
import { botBracket } from '../../utils';
import {
  ICorporateLink,
  RepositoryLockdownState,
  NoCacheNoBackground,
  OrganizationMembershipState,
  OrganizationMembershipRole,
} from '../../interfaces';
import { CreateError } from '../../transitional';
import {
  ILockdownResult,
  INewRepositoryLockdownSystemOptions,
  IRepoPatch,
  RepositoryLockdownCreateOptions,
  RepositoryLockdownCreateType,
} from './interfaces';
import { sendLockdownMails } from './lockdownMail';
import { administrativeApproval } from './approve';
import { selfServiceDeleteLockedRepository } from './selfServiceDelete';
import { initializeRepositoryMetadata } from './initializeMetadata';
import { setupRepositorySubstring } from './strings';
import { immediatelyDeleteFork, tryCreateReadme } from './actions';
import { repositoryLockdownStatics } from './staticFunctions';
import { lockdownRepository } from './actions/lockdown';

export default class NewRepositoryLockdownSystem {
  organization: Organization;
  operations: Operations;
  repository: Repository;
  repositoryMetadataProvider: IRepositoryMetadataProvider;

  private readonly deleteForks: boolean;
  private readonly lockdownForks: boolean;
  private readonly lockdownTransfers: boolean;

  constructor(options: INewRepositoryLockdownSystemOptions) {
    this.organization = options.organization;
    this.operations = options.operations;
    this.repository = options.repository;
    this.repositoryMetadataProvider = options.repositoryMetadataProvider;

    this.deleteForks = this.organization.isForkDeleteSystemEnabled();
    this.lockdownForks = this.organization.isForkLockdownSystemEnabled();
    this.lockdownTransfers = this.organization.isTransferLockdownSystemEnabled();
  }

  static get Statics() {
    return repositoryLockdownStatics;
  }

  removeAdministrativeLock(): Promise<void> {
    return administrativeApproval(this.operations, this.repositoryMetadataProvider, this.repository);
  }

  async deleteLockedRepository(
    onlyDeleteIfAdministrativeLocked: boolean,
    deletedByUser: boolean
  ): Promise<void> {
    selfServiceDeleteLockedRepository(
      this.operations,
      this.repositoryMetadataProvider,
      this.repository,
      onlyDeleteIfAdministrativeLocked,
      deletedByUser
    );
  }

  async lockdownIfNecessary(
    action: RepositoryLockdownCreateType,
    username: string,
    thirdPartyId: number,
    transferSourceRepositoryLogin: string
  ): Promise<RepositoryLockdownState> {
    let outcome: ILockdownResult = null;
    try {
      outcome = await this.lockdownIfNecessaryImpl(action, username, transferSourceRepositoryLogin);
      if (!outcome) {
        throw CreateError.ServerError('No lockdown outcome');
      }
    } catch (error) {
      throw error;
    }
    const lockdownState =
      outcome.lockdownState || (outcome.wasLocked ? RepositoryLockdownState.Locked : null);
    const lockdownLog = outcome.log || [];
    const isTransfer = action === RepositoryLockdownCreateType.Transferred;
    const isFork = !!this.repository.fork;
    const isForkAdministratorLocked = isFork && lockdownState === RepositoryLockdownState.AdministratorLocked;

    let link: ICorporateLink = null;
    try {
      link = await this.operations.getLinkByThirdPartyId(thirdPartyId.toString());
    } catch (noLinkError) {
      lockdownLog.push(
        `No corporate link available for the GitHub username ${username} that created the repository`
      );
    }

    const options: RepositoryLockdownCreateOptions = {
      instances: {
        repository: this.repository,
      },
      providers: {
        repositoryMetadataProvider: this.repositoryMetadataProvider,
        operations: this.operations,
      },
      lockdownLog,
      lockdownState,
      action,
      username,
      transferSourceRepositoryLogin,
      link,
      thirdPartyId,
    };

    // Repository metadata
    await initializeRepositoryMetadata(options);

    await sendLockdownMails(
      this.operations,
      this.repository,
      outcome,
      link,
      action,
      lockdownLog,
      lockdownState,
      username,
      transferSourceRepositoryLogin
    );

    const insights = this.operations.insights;
    if (insights) {
      let metricName = 'CreatedRepos';
      if (isForkAdministratorLocked) {
        metricName = 'CreatedForks';
      } else if (isTransfer) {
        metricName = 'CreatedTransfers';
      } else if (lockdownState === RepositoryLockdownState.Deleted) {
        metricName = 'DeletedForks';
      }
      insights.trackMetric({ name: metricName, value: 1 });
    }
    console.dir(lockdownLog);

    return lockdownState;
  }

  private async lockdownIfNecessaryImpl(
    action: RepositoryLockdownCreateType,
    username: string,
    transferSourceRepositoryLogin: string
  ): Promise<ILockdownResult> {
    const lockdownLog: string[] = [];
    // reconfirm that the new repository system is enabled for this organization
    if (!this.organization.isNewRepositoryLockdownSystemEnabled()) {
      return { wasLocked: false, notifyOperations: false };
    }
    lockdownLog.push(
      `Confirmed that the ${this.organization.name} organization has opted into the new repository lockdown system`
    );
    if (this.deleteForks) {
      lockdownLog.push(
        'Confirmed that the delete fork feature is enabled for this org. It will supersede fork lockdown capabilities.'
      );
    }
    if (this.lockdownForks) {
      lockdownLog.push('Confirmed that the additional fork lockdown feature is enabled for this org');
    }
    if (this.lockdownTransfers) {
      lockdownLog.push('Confirmed that the additional transfer lockdown feature is enabled for this org');
    }
    const setupUrl = `${this.organization.absoluteBaseUrl}wizard?existingreponame=${this.repository.name}&existingrepoid=${this.repository.id}`;
    const isTransfer = action === RepositoryLockdownCreateType.Transferred;
    if (isTransfer && !this.lockdownTransfers) {
      return { wasLocked: false, notifyOperations: false }; // no need to do special transfer logic
    }
    if (isTransfer && transferSourceRepositoryLogin) {
      const isInternalTransfer = this.operations.isManagedOrganization(transferSourceRepositoryLogin);
      if (isInternalTransfer) {
        lockdownLog.push(
          `Internal repository transfer from ${transferSourceRepositoryLogin} to ${this.organization.name}`
        );
        // BUSINESS RULE: If the organization is configured in the system, no need to lock it down...
        // CONSIDER: should there be a feature flag for this behavior, to allow managed-to-managed org transfers without lockdown?
        return { wasLocked: false, log: lockdownLog, notifyOperations: true };
      }
    }
    const lowercaseUsername = username.toLowerCase();
    // any repository created by a bot *is ok* and will not be locked down. If this is an issue, having an approved list of permitted bots to create repos would be one way to approach this loophole. Non-bot users cannot have brackets in their names.
    if (lowercaseUsername.includes(botBracket)) {
      lockdownLog.push(`Created by a bot or GitHub App: ${username}`);
      return { wasLocked: false, log: lockdownLog, notifyOperations: false };
    }
    lockdownLog.push(`Confirmed that the repository was not ${action} by a bot`);
    // a repository created by one of the operations accounts in the allowed list is OK and will not be locked down
    const systemAccounts = new Set(
      this.operations.systemAccountsByUsername.map((username) => username.toLowerCase())
    );
    if (systemAccounts.has(lowercaseUsername)) {
      lockdownLog.push(`Created by a system account: ${username}`);
      return { wasLocked: false, log: lockdownLog, notifyOperations: true };
    }
    lockdownLog.push(
      `Confirmed that the repository was not ${action} by any of the system accounts: ${Array.from(
        systemAccounts.values()
      ).join(', ')}`
    );
    const userMembership = await this.organization.getMembership(username, NoCacheNoBackground);
    let userIsOrganizationOwner = false;
    if (
      userMembership?.state === OrganizationMembershipState.Active &&
      userMembership?.role === OrganizationMembershipRole.Admin
    ) {
      userIsOrganizationOwner = true;
    }
    // CONSIDER: is a feature flag needed - whether to allow org owners to fork
    if (userIsOrganizationOwner && (this.lockdownForks || this.deleteForks)) {
      lockdownLog.push(
        `Allowing current organization owner ${username} of org ${this.organization.name} to create this fork`
      );
      return { wasLocked: false, log: lockdownLog, notifyOperations: true };
    }

    const isFork = this.repository?.fork === true;
    const repositoryEntity = await this.repository.getDetails();
    const upstreamLogin = repositoryEntity.parent?.owner?.login;
    const upstreamRepositoryName = repositoryEntity.parent?.name;

    let isForkParentManagedBySystem = false;
    let lockdownState: RepositoryLockdownState = RepositoryLockdownState.Locked;
    let wasLocked = true;

    if (action === 'created' && isFork && (this.lockdownForks || this.deleteForks)) {
      if (this.lockdownForks && !this.deleteForks) {
        lockdownLog.push('The repository is a fork and will be administrator locked');
        lockdownState = RepositoryLockdownState.AdministratorLocked;
      } else if (this.deleteForks) {
        lockdownLog.push('The repository is a fork and will be deleted');
        lockdownState = RepositoryLockdownState.Deleted;
        wasLocked = false;
      }
      if (upstreamLogin && this.operations.isManagedOrganization(upstreamLogin)) {
        lockdownLog.push(
          `The parent organization, ${upstreamLogin}, is also an organization managed by the company.`
        );
        isForkParentManagedBySystem = true;
      }
    }

    if (isFork && this.deleteForks) {
      await immediatelyDeleteFork(lockdownLog, this.repository);
    } else {
      await lockdownRepository(lockdownLog, this.repository, systemAccounts, username);

      const patchChanges: IRepoPatch = {};
      if (!isFork && !isTransfer && !this.repository.private) {
        lockdownLog.push('Preparing to hide the public repository pending setup (V2)');
        patchChanges.private = true;
      }
      if (!isFork) {
        lockdownLog.push('Updating the description and web site to point at the setup wizard (V2)');
        lockdownLog.push(`Will direct the user to ${setupUrl}`);
        patchChanges.description = `${setupRepositorySubstring} ${setupUrl}`;
        patchChanges.homepage = setupUrl;
      }
      if (Object.getOwnPropertyNames(patchChanges).length > 0) {
        try {
          const descriptiveUpdate = Object.getOwnPropertyNames(patchChanges)
            .map((key) => {
              return `${key}=${patchChanges[key]}`;
            })
            .join(', ');
          lockdownLog.push(`Updating repository with patch ${descriptiveUpdate}`);
          await this.repository.update(patchChanges);
        } catch (hideError) {
          lockdownLog.push(`Error while trying to update the new repo: ${hideError} (V2)`);
        }
      }
    }

    if (!isFork && !isTransfer) {
      try {
        await tryCreateReadme(this.repository, lockdownLog);
      } catch (readmeError) {
        lockdownLog.push(`Error with README updates: ${readmeError}`);
      }
    }

    return {
      wasLocked,
      notifyOperations: true,
      log: lockdownLog,
      setupUrl,
      lockdownState,
      upstreamLogin,
      upstreamRepositoryName,
      isForkParentManagedBySystem,
    };
  }
}
