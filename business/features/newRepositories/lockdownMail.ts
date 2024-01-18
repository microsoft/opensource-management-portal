//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Operations, Repository } from '../..';
import { ICachedEmployeeInformation, ICorporateLink, RepositoryLockdownState } from '../../../interfaces';
import { IMail } from '../../../lib/mailProvider';
import getCompanySpecificDeployment from '../../../middleware/companySpecificDeployment';
import { ILockdownResult, IMailToLockdownRepo, RepositoryLockdownCreateType } from './interfaces';

const defaultMailTemplate = 'newrepolockdown';

export async function sendLockdownMails(
  operations: Operations,
  repository: Repository,
  outcome: ILockdownResult,
  link: ICorporateLink,
  action: RepositoryLockdownCreateType,
  lockdownLog: string[],
  lockdownState: RepositoryLockdownState,
  username: string,
  transferSourceRepositoryLogin: string
): Promise<void> {
  const companySpecific = getCompanySpecificDeployment();
  const organization = repository.organization;
  const { wasLocked, notifyOperations } = outcome;

  const isTransfer = action === RepositoryLockdownCreateType.Transferred;
  const isFork = !!repository.fork;
  const isForkAdministratorLocked = isFork && lockdownState === RepositoryLockdownState.AdministratorLocked;
  const isForkDeleted = isFork && lockdownState === RepositoryLockdownState.Deleted;

  const { isForkParentManagedBySystem, upstreamLogin, upstreamRepositoryName, setupUrl } = outcome;

  // Mail

  let mailSentToCreator = false;
  const operationsMails = [operations.getRepositoriesNotificationMailAddress()];
  const defaultAdministrativeUnlockUrl = `${repository.absoluteBaseUrl}administrativeLock`;
  const lockdownMailContent: IMailToLockdownRepo = {
    username,
    log: lockdownLog,
    organization,
    repository,
    linkToDeleteRepository: repository.absoluteBaseUrl + 'delete',
    linkToClassifyRepository: setupUrl,
    linkToAdministrativeUnlockRepository:
      companySpecific?.urls?.getAdministrativeUnlockUrl(repository) || defaultAdministrativeUnlockUrl,
    mailAddress: null,
    link,
    isForkAdministratorLocked,
    isForkDeleted,
  };
  if (wasLocked) {
    lockdownLog.push(`The repo can be unlocked at ${lockdownMailContent.linkToClassifyRepository}`);
  }
  const repoActionType = repoActionTypeTranslation(repository, isTransfer);
  const stateVerb = isTransfer ? 'transferred' : 'new';
  const forkUnlockMail = operations.config.brand?.forkApprovalMail || operations.config.brand?.operationsMail;
  const mailView = companySpecific?.views?.email?.repository?.newDirect || defaultMailTemplate;
  if (link && (wasLocked === true || isForkDeleted)) {
    try {
      const mailAddress =
        link.corporateMailAddress ||
        (await operations.getMailAddressFromCorporateUsername(link.corporateUsername));
      const repoName = repository.name;
      let subject = isForkAdministratorLocked
        ? `Your new fork requires administrator approval: ${repoName} (${username})`
        : `Configure your ${stateVerb} GitHub repository ${repoName} (${username})`;
      if (isForkDeleted) {
        subject = `Your corporate fork ${repoName} was deleted (${username})`;
      }
      if (mailAddress) {
        lockdownMailContent.mailAddress = mailAddress;
        const companyName = operations.config.brand.companyName;
        let managerInfo: ICachedEmployeeInformation = null;
        let reasonInfo = `This mail was sent to: ${mailAddress}`;
        try {
          const providers = operations.providers;
          let shouldTryNotifyManager = !isForkDeleted;
          if (providers?.customizedNewRepositoryLogic) {
            // this is a hack around the new repo custom logic
            const customContext = providers.customizedNewRepositoryLogic.createContext({ lockdownState });
            shouldTryNotifyManager = providers.customizedNewRepositoryLogic.shouldNotifyManager(
              customContext,
              link.corporateId
            );
          }
          if (shouldTryNotifyManager) {
            managerInfo = await operations.getCachedEmployeeManagementInformation(link.corporateId);
            if (managerInfo && managerInfo.managerMail) {
              reasonInfo += ` and manager ${managerInfo.managerMail}`;
            }
          }
        } catch (managerInfoError) {
          console.dir(managerInfoError);
        }
        let reason = `You just ${repoActionType} a repository on GitHub and have additional actions required to gain access to continue to use it after classification. ${reasonInfo}.`;
        if (isForkDeleted) {
          reason = `Your corporate fork was deleted. This mail is explaining why.`;
        }
        let headline = isForkAdministratorLocked
          ? 'Fork approval required'
          : `Setup your ${stateVerb} repository`;
        if (isForkDeleted) {
          headline = 'Oops';
        }
        const mailToCreator: IMail = {
          to: mailAddress,
          subject,
          content: await operations.emailRender(mailView, {
            reason,
            headline,
            notification: isForkAdministratorLocked ? 'action' : 'information',
            app: `${companyName} GitHub`,
            hasAccountInformationSection: true,
            //
            isMailToCreator: true,
            lockdownMailContent,
            isForkAdministratorLocked,
            isForkDeleted,
            isForkParentManagedBySystem,
            upstreamLogin,
            upstreamRepositoryName,
            linkToAdministrativeUnlockRepository:
              companySpecific?.urls?.getAdministrativeUnlockUrl(repository) || defaultAdministrativeUnlockUrl,
            action,
            username,
            forkUnlockMail,
            operationsMail: operationsMails.join(','),
            transferSourceRepositoryLogin,
          }),
        };
        if (managerInfo && managerInfo.managerMail) {
          mailToCreator.cc = managerInfo.managerMail;
        }
        await operations.sendMail(mailToCreator);
        lockdownLog.push(
          `sent an e-mail to the person who ${repoActionType} the repository ${mailAddress} (corporate username: ${link.corporateUsername})`
        );
        mailSentToCreator = true;
      } else {
        lockdownLog.push(`no e-mail address available for the corporate username ${link.corporateUsername}`);
      }
    } catch (noLinkOrEmail) {
      console.dir(noLinkOrEmail);
    }
  }
  if (notifyOperations && operationsMails) {
    try {
      const subject = isForkAdministratorLocked
        ? `New fork ${organization.name}/${repository.name} requires approval - forked by ${username}`
        : `Repository ${repoActionType}: ${organization.name}/${repository.name} (by ${username})`;
      const mailToOperations: IMail = {
        to: operationsMails,
        subject,
        content: await operations.emailRender(mailView, {
          reason: `A user just ${repoActionType} this repository directly on GitHub. As the operations contact for this system, you are receiving this e-mail.
                    This mail was sent to: ${operationsMails.join(', ')}`,
          headline: isForkAdministratorLocked
            ? `Fork ${organization.name}/${repository.name} by ${username}`
            : `Repo (${stateVerb}) ${organization.name}/${repository.name} ${repoActionType} by ${username}`,
          notification: 'information',
          app: `${operations.config.brand.companyName} GitHub`,
          isMailToOperations: true,
          lockdownMailContent,
          forkUnlockMail,
          transferSourceRepositoryLogin,
          action,
          mailSentToCreator,
          isForkAdministratorLocked,
        }),
      };
      await operations.sendMail(mailToOperations);
      lockdownLog.push(`sent an e-mail to the operations contact(s): ${operationsMails.join(', ')}`);
    } catch (mailIssue) {
      console.dir(mailIssue);
    }
  }
}

function repoActionTypeTranslation(repository: any, isTransfer: boolean) {
  if (repository.fork) {
    return 'forked';
  }
  if (isTransfer) {
    return 'transferred';
  }
  return 'created';
}
