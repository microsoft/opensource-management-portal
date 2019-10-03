//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Operations } from '../business/operations';
import { Organization } from '../business/organization';
import { Repository } from '../business/repository';
import { Team } from '../business/team';
import { ICorporateLink } from '../business/corporateLink';
import { IMail } from '../lib/mailProvider';
import { IRepositoryMetadataProvider } from '../entities/repositoryMetadata/repositoryMetadataProvider';
import { RepositoryMetadataEntity } from '../entities/repositoryMetadata/repositoryMetadata';

const botBracket = '[bot]';

interface IMailToLockdownRepo {
  username: string;
  log: string[];
  organization: Organization;
  repository: Repository;
  linkToClassifyRepository: string;
  mailAddress?: string;
  link?: ICorporateLink;
}

export interface INewRepositoryLockdownSystemOptions {
  operations: Operations;
  organization: Organization;
  repository: Repository;
  repositoryMetadataProvider: IRepositoryMetadataProvider;
}

export default class NewRepositoryLockdownSystem {
  organization: Organization;
  operations: Operations;
  repository: Repository;
  repositoryMetadataProvider: IRepositoryMetadataProvider;

  constructor(options: INewRepositoryLockdownSystemOptions) {
    this.organization = options.organization;
    this.operations = options.operations;
    this.repository = options.repository;
    this.repositoryMetadataProvider = options.repositoryMetadataProvider;
  }

  private populateRepositoryMetadata(entity: RepositoryMetadataEntity, username: string, userId: number, link: ICorporateLink) {
    entity.createdByThirdPartyUsername = username;
    entity.createdByThirdPartyId = userId.toString();
    if (link) {
      entity.createdByCorporateDisplayName = link.corporateDisplayName;
      entity.createdByCorporateId = link.corporateId;
      entity.createdByCorporateUsername = link.corporateUsername;
    }
    return entity;
  }

  async lockdownIfNecessary(username: string, thirdPartyId: number): Promise<boolean> {
    const lockdownLog: string[] = [];
    // reconfirm that the new repository system is enabled for this organization
    if (!this.organization.isNewRepositoryLockdownSystemEnabled()) {
      return false;
    }
    lockdownLog.push(`Confirmed that the ${this.organization.name} organization has opted in to the new repository lockdown system`);
    const lowercaseUsername = username.toLowerCase();
    // any repository created by a bot *is ok* and will not be locked down. If this is an issue, having an approved list of permitted bots to create repos would be one way to approach this loophole. Non-bot users cannot have brackets in their names.
    if (lowercaseUsername.includes(botBracket)) {
      return false;
    }
    lockdownLog.push('Confirmed that the repository was not created by a bot');
    // a repository created by one of the operations accounts in the allowed list is OK and will not be locked down
    const systemAccounts = new Set(this.operations.systemAccountsByUsername.map(username => username.toLowerCase()));
    if (systemAccounts.has(lowercaseUsername)) {
      return false;
    }
    lockdownLog.push(`Confirmed that the repository was not created by any of the system accounts: ${Array.from(systemAccounts.values()).join(', ')}`);
    await this.lockdownRepository(lockdownLog, systemAccounts);
    let link: ICorporateLink = null;
    try {
      link = await this.operations.getLinkByThirdPartyId(thirdPartyId.toString());
    } catch (noLinkError) {
      lockdownLog.push(`No corporate link available for the GitHub username ${username} that created the repository`);
    }
    try {
      // Repository metadata is used to lock down the security of the repository system. Only
      // a complete system administrator or the initial creator of a repository is able to
      // complete the initial repository setup process.
      let repositoryMetadata: RepositoryMetadataEntity = null;
      try {
        repositoryMetadata = await this.repositoryMetadataProvider.getRepositoryMetadata(this.repository.id.toString());
      } catch (doesNotExist) {
        // ignore: 404 is standard here
      }
      if (repositoryMetadata) {
        lockdownLog.push(`Repository metadata already exists for repository ID ${this.repository.id}`);
        await this.repositoryMetadataProvider.updateRepositoryMetadata(this.populateRepositoryMetadata(repositoryMetadata, username, thirdPartyId, link));
        lockdownLog.push(`Updated the repository metadata with username and link information`);
      } else {
        repositoryMetadata = this.populateRepositoryMetadata(new RepositoryMetadataEntity(), username, thirdPartyId, link);
        repositoryMetadata.created = new Date();
        repositoryMetadata.repositoryId = this.repository.id.toString();
        repositoryMetadata.repositoryName = this.repository.name;
        repositoryMetadata.organizationName = this.organization.name;
        repositoryMetadata.organizationId = this.organization.id.toString();
        await this.repositoryMetadataProvider.createRepositoryMetadata(repositoryMetadata);
        lockdownLog.push(`Created the initial repository metadata indicating the repo was created by ${username}`);
      }
    } catch (metadataSystemError) {
      console.dir(metadataSystemError);
      lockdownLog.push(`While writing repository metadata an error: ${metadataSystemError.message}`);
    }
    let mailSentToCreator = false;
    const lockdownMailContent: IMailToLockdownRepo = {
      username,
      log: lockdownLog,
      organization: this.organization,
      repository: this.repository,
      linkToClassifyRepository: 'https://google.com', // TODO: link similar to https://repos.opensource.microsoft.com/microsoft/wizard?existingreponame=opensource-portal
      mailAddress: null,
      link,
    };
    if (link) {
      try {
        const mailAddress = await this.operations.getMailAddressFromCorporateUsername(link.corporateUsername);
        if (mailAddress) {
          const mailToCreator: IMail = {
            to: mailAddress,
            subject: `Please complete the setup of your new GitHub repository ${this.repository.name} (${username})`,
            content: await this.operations.emailRender('newrepolockdown', {
              reason: (`You just created a repository on GitHub and have additional actions required to gain access to continue to use it after classification.
                        This mail was sent to: ${mailAddress}`),
              headline: `Setup your new repository`,
              notification: 'information',
              app: `${this.operations.config.brand.companyName} GitHub`,
              isMailToCreator: true,
              lockdownMailContent,
            }),
          };
          await this.operations.sendMail(mailToCreator);
          lockdownLog.push(`sent an e-mail to the repository creator ${mailAddress} (corporate username: ${link.corporateUsername})`);
          mailSentToCreator = true;
        } else {
          lockdownLog.push(`no e-mail address available for the corporate username ${link.corporateUsername}`);
        }
      } catch (noLinkOrEmail) {
        console.dir(noLinkOrEmail);
      }
    }
    const operationsMail = this.operations.getOperationsMailAddress();
    if (operationsMail) {
      try {
        const mailToOperations: IMail = {
          to: operationsMail,
          subject: `A new repository ${this.organization.name}/${this.repository.name} was created directly on GitHub by ${username}`,
          content: await this.operations.emailRender('newrepolockdown', {
            reason: (`A user just created this new repository directly on GitHub. As the operations contact for this system, you are receiving this e-mail.
                      This mail was sent to: ${operationsMail}`),
            headline: `New repo ${this.organization.name}/${this.repository.name} created by ${username}`,
            notification: 'information',
            app: `${this.operations.config.brand.companyName} GitHub`,
            isMailToOperations: true,
            lockdownMailContent,
            mailSentToCreator,
          }),
        };
        await this.operations.sendMail(mailToOperations);
        lockdownLog.push(`sent an e-mail to the operations contact ${operationsMail}`);
      } catch (mailIssue) {
        console.dir(mailIssue);
      }
    }
    console.dir(lockdownLog);
    return true;
  }

  async lockdownRepository(log: string[], systemAccounts: Set<string>): Promise<void> {
    try {
      const specialPermittedTeams = new Set([
        ...this.organization.specialRepositoryPermissionTeams.admin,
        ...this.organization.specialRepositoryPermissionTeams.write,
        ...this.organization.specialRepositoryPermissionTeams.read]);
      const teamPermissions = await this.repository.getTeamPermissions();
      for (const tp of teamPermissions) {
        if (specialPermittedTeams.has(tp.team.id)) {
          log.push(`Special permitted team id=${tp.team.id} name=${tp.team.name} will continue to have repository access`);
        } else {
          await this.tryDropTeam(this.repository, tp.team, log);
        }
      }
      const collaborators = await this.repository.getCollaborators();
      for (const collaborator of collaborators) {
        if (systemAccounts.has(collaborator.login.toLowerCase())) {
          log.push(`System account ${collaborator.login} will continue to have repository access`);
        } else {
          await this.tryDropCollaborator(this.repository, collaborator.login, log);
        }
      }
      log.push('Lockdown of permissions complete');
    } catch (lockdownError) {
      log.push(`Error while locking down the repository: ${lockdownError.message}`);
    }
  }

  async tryDropTeam(repository: Repository, team: Team, log: string[]): Promise<void> {
    try {
      const result = await repository.removeTeamPermission(team.id);
      log.push(`Lockdown removed team id=${team.id} name=${team.name} from the repository ${repository.name} in organization ${repository.organization.name}`);
    } catch (lockdownError) {
      log.push(`Error while removing team id=${team.id} name=${team.name} permission from the repository ${repository.name} in organization ${repository.organization.name}: ${lockdownError.message}`);
    }
  }

  async tryDropCollaborator(repository: Repository, login: string, log: string[]): Promise<void> {
    try {
      const result = await repository.removeCollaborator(login);
      log.push(`Lockdown removed collaborator login=${login} from the repository ${repository.name} in organization ${repository.organization.name}`);
    } catch (lockdownError) {
      log.push(`Error while removing collaborator login=${login} from the repository ${repository.name} in organization ${repository.organization.name}: ${lockdownError.message}`);
    }
  }
}
