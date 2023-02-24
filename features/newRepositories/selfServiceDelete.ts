//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Operations, Repository } from '../../business';
import { IRepositoryMetadataProvider } from '../../entities/repositoryMetadata/repositoryMetadataProvider';
import { ICachedEmployeeInformation, RepositoryLockdownState } from '../../interfaces';
import { IMail } from '../../lib/mailProvider';

export async function selfServiceDeleteLockedRepository(
  operations: Operations,
  repositoryMetadataProvider: IRepositoryMetadataProvider,
  repository: Repository,
  onlyDeleteIfAdministrativeLocked: boolean,
  deletedByUser: boolean
): Promise<void> {
  const insights = operations.providers.insights;
  const organization = repository.organization;
  if (!organization.isNewRepositoryLockdownSystemEnabled()) {
    throw new Error('lockdown system not enabled');
  }
  const repositoryMetadata = await repositoryMetadataProvider.getRepositoryMetadata(repository.id.toString());
  insights?.trackEvent({
    name: 'IntendedLockedRepoDelete',
    properties: {
      organization: organization.name,
      repository: repository.name,
      repositoryId: repository.id.toString(),
    },
  });
  if (
    onlyDeleteIfAdministrativeLocked &&
    repositoryMetadata.lockdownState !== RepositoryLockdownState.AdministratorLocked
  ) {
    throw new Error(
      `Repository's current lockdown state is not administrative. It is: ${repositoryMetadata.lockdownState}`
    );
  }
  const targetType = repository.fork ? 'Fork' : 'Repo';
  const repoName = repository.name;
  try {
    await repository.delete();
    insights?.trackEvent({
      name: 'LockedRepoDeleted',
      properties: {
        organization: organization.name,
        repository: repository.name,
        repositoryId: repository.id.toString(),
      },
    });
  } catch (deleteError) {
    console.dir(deleteError);
    insights?.trackException({
      exception: deleteError,
      properties: {
        organization: organization.name,
        repository: repository.name,
        repositoryId: repository.id.toString(),
      },
    });
  }
  try {
    const mailAddress = await operations.getMailAddressFromCorporateUsername(
      repositoryMetadata.createdByCorporateUsername
    );
    let managerInfo: ICachedEmployeeInformation = null;
    let reasonInfo = `This mail was sent to: ${mailAddress}`;
    try {
      managerInfo = await operations.getCachedEmployeeManagementInformation(
        repositoryMetadata.createdByCorporateId
      );
      if (managerInfo && managerInfo.managerMail) {
        reasonInfo += ` and manager ${managerInfo.managerMail}`;
      }
    } catch (managerInfoError) {
      console.dir(managerInfoError);
    }
    const companyName = operations.config.brand.companyName;
    const mailToCreator: IMail = {
      to: mailAddress,
      subject: `${targetType} deleted by ${
        deletedByUser ? repositoryMetadata.createdByCorporateUsername : 'operations'
      }: ${repository.organization.name}/${repoName}`,
      content: await operations.emailRender('lockedrepodeleted', {
        reason: `The ${targetType.toLowerCase()} was deleted. ${reasonInfo}.`,
        headline: `${targetType} deleted`,
        notification: 'information',
        app: `${companyName} GitHub`,
        isMailToCreator: true,
        deletedByUser,
        isFork: repository.fork,
        creator: repositoryMetadata.createdByCorporateUsername,
        repository: repository,
      }),
    };
    if (managerInfo && managerInfo.managerMail) {
      mailToCreator.cc = managerInfo.managerMail;
    }
    await operations.sendMail(mailToCreator);
  } catch (noLinkOrEmail) {
    console.dir(noLinkOrEmail);
  }
  const operationsMails = [operations.getRepositoriesNotificationMailAddress()];
  if (operationsMails && operationsMails.length) {
    try {
      const mailToOperations: IMail = {
        to: operationsMails,
        subject: `${targetType} deleted by ${
          deletedByUser ? repositoryMetadata.createdByCorporateUsername : 'operations'
        }: ${repository.organization.name}/${repoName}`,
        content: await operations.emailRender('lockedrepodeleted', {
          reason: `A decision has been made to delete this repo.
                    This mail was sent to operations at: ${operationsMails.join(', ')}`,
          headline: `${targetType} deleted`,
          isFork: repository.fork,
          notification: 'information',
          deletedByUser,
          app: `${operations.config.brand.companyName} GitHub`,
          isMailToOperations: true,
          creator: repositoryMetadata.createdByCorporateUsername,
          repository: repository,
        }),
      };
      await operations.sendMail(mailToOperations);
    } catch (mailIssue) {
      console.dir(mailIssue);
    }
  }
  insights?.trackMetric({ name: 'LockedRepoDeletes', value: 1 });
  insights?.trackMetric({
    name: deletedByUser ? 'LockedRepoUserDeletes' : 'LockedRepoAdminDeletes',
    value: 1,
  });
}
