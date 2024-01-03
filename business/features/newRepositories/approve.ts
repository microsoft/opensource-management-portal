//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Operations, Repository } from '../..';
import { IRepositoryMetadataProvider } from '../../entities/repositoryMetadata/repositoryMetadataProvider';
import { ICachedEmployeeInformation, RepositoryLockdownState } from '../../../interfaces';
import { IMail } from '../../../lib/mailProvider';
import { IMailToRemoveAdministrativeLock } from './interfaces';

export async function administrativeApproval(
  operations: Operations,
  repositoryMetadataProvider: IRepositoryMetadataProvider,
  repository: Repository
): Promise<void> {
  const organization = repository.organization;
  if (!organization.isNewRepositoryLockdownSystemEnabled()) {
    throw new Error('lockdown system not enabled');
  }
  if (!repository.id) {
    await repository.getDetails();
  }
  const repositoryMetadata = await repositoryMetadataProvider.getRepositoryMetadata(repository.id.toString());
  if (repositoryMetadata.lockdownState !== RepositoryLockdownState.AdministratorLocked) {
    throw new Error(
      `Repository's current lockdown state is not administrative. It is: ${repositoryMetadata.lockdownState}`
    );
  }
  repositoryMetadata.lockdownState = RepositoryLockdownState.Locked;
  await repositoryMetadataProvider.updateRepositoryMetadata(repositoryMetadata);
  let mailSentToCreator = false;
  const lockdownMailContent: IMailToRemoveAdministrativeLock = {
    organization,
    repository,
    linkToClassifyRepository:
      organization.absoluteBaseUrl +
      `wizard?existingreponame=${repository.name}&existingrepoid=${repository.id}`,
    linkToDeleteRepository: repository.absoluteBaseUrl + 'delete',
    mailAddress: null,
  };
  try {
    lockdownMailContent.mailAddress = await operations.getMailAddressFromCorporateUsername(
      repositoryMetadata.createdByCorporateUsername
    );
    const repoName = repository.name;
    const companyName = operations.config.brand.companyName;
    let managerInfo: ICachedEmployeeInformation = null;
    let reasonInfo = `This mail was sent to: ${lockdownMailContent.mailAddress}`;
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
    const mailToCreator: IMail = {
      to: lockdownMailContent.mailAddress,
      subject: `Your repo was approved, please complete its setup: ${repoName}`,
      content: await operations.emailRender('newrepolockremoved', {
        reason: `Your new repo was approved. Additional actions are now required to gain access to continue to use it after classification.
                  ${reasonInfo}.`,
        headline: 'Repo approved',
        notification: 'action',
        app: `${companyName} GitHub`,
        isMailToCreator: true,
        lockdownMailContent,
      }),
    };
    if (managerInfo && managerInfo.managerMail) {
      mailToCreator.cc = managerInfo.managerMail;
    }
    await operations.sendMail(mailToCreator);
    mailSentToCreator = true;
  } catch (noLinkOrEmail) {
    console.dir(noLinkOrEmail);
  }
  const notifyMailAddress = operations.getRepositoriesNotificationMailAddress();
  const operationsMails = notifyMailAddress ? [notifyMailAddress] : [];
  if (operationsMails && operationsMails.length) {
    try {
      const subject = `Repo approved by an administrator - ${organization.name}/${repository.name}`;
      const mailToOperations: IMail = {
        to: operationsMails,
        subject,
        content: await operations.emailRender('newrepolockremoved', {
          reason: `An administrator has approved this repo, removing an administrative lock. As the operations contact for this system, you are receiving this e-mail.
                    This mail was sent to: ${operationsMails.join(', ')}`,
          headline: `Administrative lock removed: ${organization.name}/${repository.name}`,
          notification: 'information',
          app: `${operations.config.brand.companyName} GitHub`,
          isMailToOperations: true,
          lockdownMailContent,
          mailSentToCreator,
        }),
      };
      await operations.sendMail(mailToOperations);
    } catch (mailIssue) {
      console.dir(mailIssue);
    }
  }
  const insights = operations.insights;
  if (insights) {
    insights.trackMetric({ name: 'LockedRepoAdminUnlocks', value: 1 });
  }
}
