//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// COLLABORATOR on a repository

import { WebhookProcessor } from '../organizationProcessor.js';
import { Operations, Organization } from '../../index.js';
import { IProviders, GitHubCollaboratorType } from '../../../interfaces/index.js';
import { ErrorHelper } from '../../../lib/transitional.js';

export default class MemberWebhookProcessor implements WebhookProcessor {
  filter(data: any) {
    const eventType = data.properties.event;
    return eventType === 'member';
  }

  async run(providers: IProviders, organization: Organization, data: any): Promise<any> {
    const operations = providers.operations as Operations;
    const queryCache = providers.queryCache;
    const event = data.body;
    const organizationIdAsString = event.organization.id.toString();
    if (!operations.isOrganizationManagedById(event.organization.id)) {
      console.log(
        `skipping organization ID ${event.organization.id} which is not directly managed: ${event.organization.login}`
      );
      return true;
    }

    const repositoryIdAsString = event.repository.id.toString();
    const userIdAsString = event.member.id.toString();
    const userLogin = event.member.login;
    let needToCreateOrUpdate = false;
    if (event.action && event.action === 'removed' && event.member.login && event.member.id) {
      console.log(
        `${event.organization.login} collaborator member: ${event.action} ${event.member.login} ${event.member.id} repo ${data.body.repository.id} ${data.body.repository.name}`
      );
      try {
        if (queryCache && queryCache.supportsRepositoryCollaborators) {
          await queryCache.removeRepositoryCollaborator(
            organizationIdAsString,
            repositoryIdAsString,
            userIdAsString
          );
        }
      } catch (queryCacheError) {
        console.dir(queryCacheError);
      }
    } else if (event.action && event.action === 'added' && event.member.login && event.member.id) {
      console.log(
        `${event.organization.login} collaborator member: ${event.action} ${event.member.login} ${event.member.id} repo ${data.body.repository.id} ${data.body.repository.name}`
      );
      needToCreateOrUpdate = true;
      console.log();
    } else if (event.action && event.action === 'edited' && event.member.login && event.member.id) {
      needToCreateOrUpdate = true;
      // TODO: then have to lookup the level of permission!
      // changes.permission.from = write'
    } else {
      console.dir(data);
    }

    if (needToCreateOrUpdate) {
      // look up new permission level
      // create or update
      try {
        const repositoryName = event.repository.name;
        const repository = organization.repository(repositoryName, event.repository);
        const collaborator = await repository.getCollaborator(event.member.login);
        const permission = collaborator.interpretRoleAsDetailedPermission();
        if (permission) {
          const isOrganizationMember = await organization.getMembership(userLogin);
          const collaboratorType = isOrganizationMember
            ? GitHubCollaboratorType.Direct
            : GitHubCollaboratorType.Outside;
          queryCache.addOrUpdateCollaborator(
            organizationIdAsString,
            repositoryIdAsString,
            repository,
            repositoryName,
            userIdAsString,
            userLogin,
            event.member.avatar_url,
            permission,
            collaboratorType
          );
          console.log(
            `collaborator ${collaboratorType} ${event.member.login} for repository ${repositoryName} set to permission=${permission}`
          );
        } else {
          console.log(
            `no permission level returned for ${event.member.login} for repository ${repositoryName} which was collaborator permission ${collaborator.permission}`
          );
        }
      } catch (repositoryCollaboratorError) {
        if (ErrorHelper.IsNotFound(repositoryCollaboratorError)) {
          console.log(
            `The repository ${event.repository.name} was not found, or the user has been deleted. This is OK if a new fork was deleted for example.`
          );
        } else {
          throw repositoryCollaboratorError;
        }
      }
    }

    return true;
  }
}
