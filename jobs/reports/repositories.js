//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/* eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

'use strict';

const _ = require('lodash');
const automaticTeams = require('../../webhooks/tasks/automaticTeams');
const moment = require('moment');
const Q = require('q');
const qlimit = require('qlimit');

const providerName = 'repositories';
const definitions = require('./repositoryDefinitions.json');
const exemptRepositories = require('./exemptRepositories.json');
const definitionsByName = {};
for (let i = 0; i < definitions.length; i++) {
  const definition = definitions[i];
  definitionsByName[definition.name] = definition;
}

const simpleDateFormat = 'l';

// TODO: Configuration over hardcoding
const knownHardcodedClaWebhooks = new Set([
]);

function processRepositories(context) {
  return getRepos(context)
    .then(iterateRepos);
}

function getRepositoryAdministrators(repositoryContext) {
  const repository = repositoryContext.repository;
  const administrators = new Map();
  const cacheOptions = {
    backgroundRefresh: false, // immediate
    maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
  };
  return Q.allSettled([
    getRepositoryTeams(repository, cacheOptions)
      .then(justAdminTeams)
      .then(adminTeams => {
        repositoryContext.countOfAdministratorTeams = adminTeams.length;
        return Q(adminTeams);
      })
      .then(teamMembers.bind(null, cacheOptions, administrators)),
    getRepositoryDirectCollaborators(repository, cacheOptions)
      .then(justAdminCollaborators)
      .then(directAdminCollaborators => {
        repositoryContext.countOfAdministratorCollaborators = directAdminCollaborators.length;
        return Q(directAdminCollaborators);
      })
      .then(storeCollaborators.bind(null, administrators)),
  ]).then(() => {
    return Q(administrators);
  }).catch(issue => {
    throw issue;
  });
}

function teamMembers(cacheOptions, administrators, teams) {
  return Q.all(teams.map(teamPermission => {
    const deferred = Q.defer();
    const team = teamPermission.team;
    team.getMembers(cacheOptions, (error, members) => {
      if (error) {
        return deferred.reject(error);
      }
      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const id = member.id;
        let entry = administrators.get(id);
        if (!entry) {
          entry = createUserEntry(member);
          administrators.set(id, entry);
        }
        entry.reasons.memberships.push(team);
      }
      return deferred.resolve();
    });
    return deferred.promise;
  }));
}

function identifyActionableAdmins(repositoryContext, repository, administrators) {
  const data = automaticTeams.processOrgSpecialTeams(repository.organization);
  const specialTeamIds = data[2];
  const actionableAdministrators = [];
  const adminIds = Array.from(administrators.keys());
  for (let i = 0; i < adminIds.length; i++) {
    const id = adminIds[i];
    const account = administrators.get(id);

    // Remove service accounts
    if (account.link && account.link.serviceAccount) {
      continue;
    }

    // Direct collaborators should always be involved
    if (account.reasons.directCollaborator) {
      actionableAdministrators.push(account);
      continue;
    }

    // Remove administrators who are only in special teams
    let realMemberships = 0;
    for (let j = 0; j < account.reasons.memberships.length; j++) {
      const team = account.reasons.memberships[j].id;
      if (!specialTeamIds.has(team)) {
        ++realMemberships;
      }
    }

    if (realMemberships) {
      actionableAdministrators.push(account);
    }
  }
  repositoryContext.actionableAdministrators = actionableAdministrators;
  return Q(administrators);
}

function iterateRepos(context) {
  let repos = context.entities.repos;
  if (context.settings.slice) {
    let offset = 3000;
    let initial = repos.length > offset ? offset - context.settings.slice : 0;
    repos = repos.slice(initial, initial + context.settings.slice);
  }
  context.processing.repos = {
    remaining: repos.length,
  };
  const limit = qlimit(context.settings.parallelRepoProcessing || 2);
  const process = processRepository.bind(null, context);
  return Q.allSettled(repos.map(limit(process))).then(() => {
    // Settled values are not reviewed, since many are just missing repos (404)
    // for repos that have already been deleted or otherwise moved
    context.repositoryData = _.sortBy(context.repositoryData, 'nameLowercase');
  }).thenResolve(context);
}

function getRepositoryDetails(repositoryContext) {
  const deferred = Q.defer();
  const repository = repositoryContext.repository;
  const cacheOptions = {
    backgroundRefresh: false,
    maxAgeSeconds: 60 * 60 * 24, // 1 day
  };
  repository.getDetails(cacheOptions, error => {
    if (error) {
      return deferred.reject(error);
    }
    return deferred.resolve(repositoryContext);
  });

  return deferred.promise;
}

function getIndividualUserLink(context, id) {
  if (!context.linkData) {
    return Q.reject(new Error('No link information has been loaded'));
  }
  return Q(context.linkData.get(id));
}

function gatherLinkData(repositoryContext, administrators) {
  const keys = Array.from(administrators.keys());
  const limit = qlimit(2);
  return Q.allSettled(keys.map(limit(id => {
    return getIndividualUserLink(repositoryContext.parent, id).then(link => {
      const entry = administrators.get(id);
      entry.link = link;
      return Q();
    });
  }))).then(() => {
    return Q(administrators);
  }).catch(error => {
    throw error;
  });
}

function processRepository(context, repository) {
  console.log(context.processing.repos.remaining-- + ': ' + repository.full_name);

  // repo context
  const repositoryContext = {
    parent: context,
    definitionsUsed: new Set(),
    issues: {},

    name: repository.full_name,
    nameLowercase: repository.full_name.toLowerCase(),
    repository: repository,

    countOfAdministratorCollaborators: 0,
    countOfAdministratorTeams: 0,
  };

  if (!context.repositoryData) {
    context.repositoryData = [];
  }
  context.repositoryData.push(repositoryContext);

  const resolveLinks = gatherLinkData.bind(null, repositoryContext);
  const getActionableAdmins = identifyActionableAdmins.bind(null, repositoryContext, repository);
  const getUnlinkedAdmins = identityAdministratorsWithoutLinks.bind(null, repositoryContext);
  const repositoryAdmins = getRepositoryAdministrators.bind(null, repositoryContext);
  return getRepositoryDetails(repositoryContext)
    .then(repositoryAdmins)
    .then(administrators => {
      repositoryContext.administrators = administrators;
      return Q(administrators);
    })
    .then(resolveLinks)
    .then(getActionableAdmins)
    .then(getUnlinkedAdmins)
    .then(() => {
      const organization = repository.organization;
      const privateEngineering = organization.privateEngineering;

      const basicRepository = {
        repoName: repository.name,
        entityName: repository.full_name,
        orgName: organization.name,

        // Pre-populate; overwritten if and when an approval is found
        approvalType: {
          color: 'gray',
          text: 'Created on GitHub or unknown',
        },

        countOfAdministratorCollaborators: repositoryContext.countOfAdministratorCollaborators || '-',
        countOfAdministratorTeams: repositoryContext.countOfAdministratorTeams || '-',
      };

      return identifyContributorLicenseAgreeementHooks(context, repositoryContext, basicRepository).then(() => {
        return getNewRepoCreationInformation(context, repositoryContext, basicRepository).then(() => {
          const publicPrivateStatus = {
            text: repository.private ? 'Private' : 'Public',
            color: repository.private ? 'red' : 'green',
          };
          basicRepository.status = publicPrivateStatus;

          // Recipients
          repositoryContext.recipients = [];
          const corporateAdministrators = [];
          if (repositoryContext.actionableAdministrators) {
            for (let y = 0; y < repositoryContext.actionableAdministrators.length; y++) {
              const admin = repositoryContext.actionableAdministrators[y];
              if (admin && admin.link && admin.link.aadupn) {
                corporateAdministrators.push(admin.link.aadupn);
                if (!privateEngineering) {
                  // Private engineering orgs do not send individuals nags on emails for now
                  repositoryContext.recipients.push({
                    type: 'upn',
                    value: admin.link.aadupn,
                    reasons: transformReasonsToArray(admin, repository.full_name),
                  });
                }
              }
            }
          }

          // Send to org admins
          const orgName = repository.organization.name;
          const orgData = context.organizationData[orgName];
          for (let i = 0; orgData && orgData.organizationContext && orgData.organizationContext.recipients && orgData.organizationContext.recipients.length && i < orgData.organizationContext.recipients.length; i++) {
            repositoryContext.recipients.push(orgData.organizationContext.recipients[i]);
          }

          // Basic administrators info
          basicRepository.administrators = 'None';
          if (corporateAdministrators.length > 0) {
            let caLink = 'mailto:' + corporateAdministrators.join(';') + '?subject=' + repository.full_name;
            const peoplePlurality = corporateAdministrators.length > 1 ? 'people' : 'person';
            basicRepository.administrators = {
              link: caLink,
              text: `${corporateAdministrators.length} ${peoplePlurality}`,
            };
          }

          const actionEditCollaborators = {
            link: `https://github.com/${repository.full_name}/settings/collaboration`,
            text: 'Permissions',
          };
          const actionDelete = {
            link: `https://github.com/${repository.full_name}/settings`,
            text: 'Delete',
          };
          const actionView = {
            link: `https://github.com/${repository.full_name}`,
            text: 'Open',
          };
          const actionShip = {
            link: `https://github.com/${repository.full_name}/settings`,
            text: 'Ship it',
          };
          const actionViewInPortal = context.config.microsoftOpenSource ? {
            link: `${context.config.microsoftOpenSource.repos}${organization.name}/repos/${repository.name}`,
            text: 'Details',
          } : null;
          const actionConfigureCLA = context.config.microsoftOpenSource ? {
            link: `${context.config.microsoftOpenSource.repos}${organization.name}/repos/${repository.name}/extensions/cla`,
            text: 'Configure CLA',
          } : null;

          if (repositoryContext.administratorsByType.linked.length === 0 || repositoryContext.actionableAdministrators.length === 0) {
            addEntityToIssueType(context, repositoryContext, 'noRepositoryAdministrators', basicRepository, actionEditCollaborators, actionViewInPortal);
          }

          let createdAt = repository.created_at ? moment(repository.created_at) : null;
          if (createdAt) {
            basicRepository.created = createdAt.format(simpleDateFormat);
          }
          let updatedAt = repository.updated_at ? moment(repository.updated_at) : null;
          if (updatedAt) {
            basicRepository.updated = updatedAt.format(simpleDateFormat);
          }
          let pushedAt = repository.pushed_at ? moment(repository.pushed_at) : null;
          if (pushedAt) {
            basicRepository.pushed = pushedAt.format(simpleDateFormat);
          }

          let mostRecentActivityMoment = createdAt;
          let mostRecentActivity = 'Created';
          if (updatedAt && updatedAt.isAfter(mostRecentActivityMoment)) {
            mostRecentActivity = 'Updated';
            mostRecentActivityMoment = updatedAt;
          }
          if (pushedAt && pushedAt.isAfter(mostRecentActivityMoment)) {
            mostRecentActivity = 'Pushed';
            mostRecentActivityMoment = pushedAt;
          }

          const twoYearsAgo = moment().subtract(2, 'years');
          const oneYearAgo = moment().subtract(1, 'years');
          const nineMonthsAgo = moment().subtract(9, 'months');
          const thirtyDaysAgo = moment().subtract(30, 'days');
          const thisWeek = moment().subtract(7, 'days');
          const today = moment().subtract(1, 'days');

          const ageInMonths = today.diff(createdAt, 'months');
          if (ageInMonths > 0) {
            basicRepository.ageInMonths = ageInMonths === 1 ? '1 month' : ageInMonths + ' months';
          }

          const monthsSinceUpdates = today.diff(mostRecentActivityMoment, 'months');
          const timeAsString = monthsSinceUpdates + ' month' + (monthsSinceUpdates === 1 ? '' : 's');
          basicRepository.recentActivity = monthsSinceUpdates < 1 ? 'Active' : `${timeAsString} (${mostRecentActivity})`;

          if (mostRecentActivityMoment.isBefore(nineMonthsAgo)) {
            basicRepository.abandoned = {
              text: `${monthsSinceUpdates} months`,
              color: 'red',
            };
          }

          if (exemptRepositories && exemptRepositories[repository.id] && exemptRepositories[repository.id].approved && exemptRepositories[repository.id].days) {
            const exemptionExpiresAt = moment(exemptRepositories[repository.id].approved)
              .add(exemptRepositories[repository.id].days, 'days')
              .subtract(2, 'weeks');
            if (moment().isAfter(exemptionExpiresAt)) {
              basicRepository.exemptionExpiresAt = exemptionExpiresAt.format(simpleDateFormat);
              addEntityToIssueType(context, repositoryContext, 'expiringPrivateEngineeringExemptions', basicRepository, actionShip, actionDelete);
            }
          } else if (!repository.private && mostRecentActivityMoment.isBefore(twoYearsAgo)) {
            addEntityToIssueType(context, repositoryContext, 'abandonedPublicRepositories', basicRepository, actionDelete);
          } else if (repository.private && mostRecentActivityMoment.isBefore(twoYearsAgo)) {
            addEntityToIssueType(context, repositoryContext, 'twoYearOldPrivateRepositories', basicRepository, actionDelete);
          } else if (repository.private && createdAt.isBefore(oneYearAgo) && !privateEngineering) {
            addEntityToIssueType(context, repositoryContext, 'oneYearOldPrivateRepositories', basicRepository, actionDelete);
          } else if (repository.private && createdAt.isBefore(thirtyDaysAgo) && !privateEngineering) {
            addEntityToIssueType(context, repositoryContext, 'privateRepositoriesLessThanOneYear', basicRepository, actionShip, actionDelete);
          } else if (createdAt.isAfter(thisWeek) && !privateEngineering) {
            // New public and private repos
            const repositoryForManagerAndLawyer = shallowCloneWithAdditionalRecipients(basicRepository, repositoryContext.additionalRecipients);
            if (createdAt.isAfter(today)) {
              addEntityToIssueType(context, repositoryContext, 'NewReposToday', repositoryForManagerAndLawyer, actionView, actionViewInPortal);
            }
            // Always include in the weekly summary
            addEntityToIssueType(context, repositoryContext, 'NewReposWeek', repositoryForManagerAndLawyer, actionView, actionViewInPortal);
          }

          // Alert on public repos missing CLA
          if (!repository.private && !repositoryContext.hasCla) {
            addEntityToIssueType(context, repositoryContext, 'reposWithoutCLA', basicRepository, actionConfigureCLA);
          }

          // Alert on too many administrators, excluding private engineering organizations at this time
          if (!privateEngineering && repositoryContext.actionableAdministrators.length > context.settings.tooManyRepoAdministrators) {
            addEntityToIssueType(context, repositoryContext, 'repositoryTooManyAdministrators', basicRepository, actionViewInPortal, actionEditCollaborators);
          }

          return Q.delay(context, context.settings.repoDelayAfter || 0);
        });
      });
    }).catch(problem => {
      console.warn(problem);
      throw problem;
    });
}

function shallowCloneWithAdditionalRecipients(basicRepository, additionalRecipients) {
  const clone = Object.assign({}, basicRepository);
  if (additionalRecipients && additionalRecipients.length) {
    clone.additionalRecipients = additionalRecipients;
  }
  return clone;
}

function getRepositoryWebhooks(repository) {
  const deferred = Q.defer();
  repository.getWebhooks((error, webhooks) => {
    return error ? deferred.reject(error) : deferred.resolve(webhooks);
  });
  return deferred.promise;
}

function identifyContributorLicenseAgreeementHooks(context, repositoryContext) {
  const repository = repositoryContext.repository;
  if (repository.private) {
    // We are only interested in public repositories with CLAs at this time
    return Q(context);
  }

  try {
    const claLegalEntities = repository.organization.legalEntities;
    if (!claLegalEntities || claLegalEntities.length === 0) {
      return Q(context);
    }
  } catch (notConfigured) {
    // This org does not have CLA configuration
    return Q(context);
  }

  return getRepositoryWebhooks(repository).then(webhooks => {
    let hasCla = false;
    for (let i = 0; i < webhooks.length; i++) {
      const webhook = webhooks[i];
      if (webhook && webhook.config && knownHardcodedClaWebhooks.has(webhook.config.url)) {
        hasCla = true;
        break;
      }
    }
    repositoryContext.hasCla = hasCla;
    return Q(context);
  }, () => {
    return Q(context);
  });
}

function getRepositoryApprovals(dataClient, repository, callback) {
  // Only repositories created on or after 4/24/2017 have the repoId stored in
  // the approval request.
  dataClient.getRepositoryApproval('repoId', repository.id, (byIdError, approvals) => {
    if (byIdError) {
      return callback(byIdError);
    }
    if (approvals && approvals.length > 0) {
      return callback(null, approvals);
    }
    dataClient.getRepositoryApproval('repoName', repository.name, callback);
  });
}

function getNewRepoCreationInformation(context, repositoryContext, basicRepository) {
  const repository = repositoryContext.repository;
  const thisWeek = moment().subtract(7, 'days');
  let createdAt = repository.created_at ? moment(repository.created_at) : null;
  let isBrandNew = createdAt.isAfter(thisWeek);

  const dataClient = context.dataClient;
  if (!isBrandNew || !dataClient) {
    return Q(context);
  }
  const deferred = Q.defer();
  const releaseTypeMapping = context.config && context.config.github && context.config.github.approvalTypes && context.config.github.approvalTypes.fields ? context.config.github.approvalTypes.fields.approvalIdsToReleaseType : null;
  getRepositoryApprovals(dataClient, repositoryContext.repository, (error, approvals) => {
    if (error || !approvals || approvals.length === 0) {
      return deferred.resolve(context);
    }
    for (let i = 0; i < approvals.length; i++) {
      const approval = approvals[i];
      if (approval && (
        (approval.repoId == repositoryContext.repository.id /* not strict equal, data client IDs are strings vs GitHub responses use numbers */) ||
        (approval.org && approval.org.toLowerCase() === repositoryContext.repository.organization.name.toLowerCase()))) {
        basicRepository.approvalLicense = approval.license;
        basicRepository.approvalJustification = approval.justification;
        if (approval.approvalType && releaseTypeMapping) {
          const approvalTypes = Object.getOwnPropertyNames(releaseTypeMapping);
          for (let j = 0; j < approvalTypes.length; j++) {
            const id = approvalTypes[j];
            const title = releaseTypeMapping[id];
            if (approval.approvalType === id) {
              basicRepository.approvalTypeId = approval.approvalType;
              // Hard-coded specific to show justification text or approval links
              if (id === 'ReleaseReview' && approval.approvalUrl) {
                basicRepository.approvalType = {
                  text: title,
                  link: approval.approvalUrl,
                };
              } else if (id !== 'Exempt') {
                basicRepository.approvalType = title;
              } else {
                basicRepository.approvalType = `${title}: ${approval.justification}`;
              }
            }
          }
        }
        if (!basicRepository.approvalType) {
          basicRepository.approvalType = approval.approvalType; // Fallback if it's not configured in the system
        }
        const createdBy = approval.ghu;
        if (!createdBy) {
          return deferred.resolve(context);
        } else {
          basicRepository.createdBy = createdBy;
          return deferred.resolve(getIdFromUsername(context, repositoryContext.repository.organization, createdBy).then(id => {
            return getIndividualUserLink(context, id).then(link => {
              basicRepository.createdBy = link.aadname || basicRepository.createdBy;
              basicRepository.createdByUpn = link.aadupn;
              basicRepository.createdByLink = basicRepository.createdByUpn ? {
                link: `mailto:${basicRepository.createdByUpn}`,
                text: basicRepository.createdBy,
              } : basicRepository.createdBy;
              return link.aadupn ? augmentWithAdditionalRecipients(context, repositoryContext, link) : Q(context);
            });
          }));
        }
      }
    }
    return deferred.resolve(context);
  });
  return deferred.promise;
}

function augmentWithAdditionalRecipients(context, repositoryContext, createdByLink) {
  if (!createdByLink || !createdByLink.aadupn) {
    return Q(context);
  }
  const upn = createdByLink.aadupn;
  const createdByName = createdByLink.aadname || upn;
  const operations = context.operations;
  const mailAddressProvider = operations.providers.mailAddressProvider;
  // Only if the provider supports both advanced Microsoft-specific functions for now
  if (!mailAddressProvider ||
  !mailAddressProvider.getLegalContactInformationFromUpn ||
  !mailAddressProvider.getManagerInformationFromUpn) {
    return Q(context);
  }
  const fullRepoName = repositoryContext.repository.full_name;
  let additional = [];
  const deferred = Q.defer();
  mailAddressProvider.getManagerInformationFromUpn(upn, (getManagerError, managerInformation) => {
    if (getManagerError) {
      console.warn(getManagerError);
    } else if (managerInformation && managerInformation.userPrincipalName) {
      const managerName = managerInformation.preferredName || managerInformation.alias || managerInformation.userPrincipalName;
      additional.push({
        type: 'upn',
        value: managerInformation.userPrincipalName,
        reasons: [`${managerName} is the manager of ${createdByName} who created a new repository ${fullRepoName}`],
      });
    }
    mailAddressProvider.getLegalContactInformationFromUpn(upn, (getLegalError, legalInformation) => {
      if (getLegalError) {
        console.warn(getLegalError);
      } else if (legalInformation && legalInformation.legalContact && legalInformation.legalContact.userPrincipalName) {
        const lc = legalInformation.legalContact;
        const legalFriendlyName = lc.preferredName || lc.alias || lc.userPrincipalName;
        const la = legalInformation.assignedTo;
        const assignedToFriendlyName = la.preferredName || la.alias || la.userPrincipalName;
        const why = la.userPrincipalName === upn ? ' who' : `'s org within which ${createdByName}`;
        let legalReason = `${legalFriendlyName} is the legal contact assigned to ${assignedToFriendlyName}${why} created a new repository ${fullRepoName}`;
        additional.push({
          type: 'upn',
          value: legalInformation.legalContact.userPrincipalName,
          reasons: [legalReason],
        });
      }
      if (additional.length) {
        repositoryContext.additionalRecipients = additional;
      }
      return deferred.resolve(context);
    });
  });
  return deferred.promise;
}

function getIdFromUsername(context, organization, username) {
  // Depends on this being a current member of an org
  const operations = context.operations;
  const deferred = Q.defer();
  const cacheOptions = {
    backgroundRefresh: true,
    maxAgeSeconds: 60 * 60 * 24 * 7 /* 1 week */,
  };
  operations.getMembers(organization.name, cacheOptions, (error, members) => {
    if (error) {
      return deferred.reject(error);
    }
    const match = username.toLowerCase();
    for (let i = 0; i < members.length; i++) {
      if (members[i].login && members[i].login.toLowerCase() === match) {
        return deferred.resolve(members[i].id);
      }
    }
    return deferred.reject();
  });
  return deferred.promise;
}

function addEntityToIssueType(context, repositoryContext, type, entity, optionalAction1, optionalAction2) {
  const definition = definitionsByName[type];
  if (!definition) {
    throw new Error(`No defined issue type ${type}`);
  }
  let hadActions = true && entity.actions;
  const entityClone = Object.assign({}, entity);
  if (hadActions) {
    delete entityClone.actions;
  }
  if (!entityClone.actions && optionalAction1) {
    entityClone.actions = { actions: [] };
  }
  if (optionalAction1) {
    entityClone.actions.actions.push(optionalAction1);
  }
  if (optionalAction2) {
    entityClone.actions.actions.push(optionalAction2);
  }

  // Track that the definition was used provider-wide and per-entity
  repositoryContext.definitionsUsed.add(type);
  if (!context.visitedDefinitions[providerName]) {
    context.visitedDefinitions[providerName] = new Set();
  }
  context.visitedDefinitions[providerName].add(type);

  const placeholder = repositoryContext.issues;
  let propertyName = null;
  if (!placeholder[type]) {
    const entry = {};
    placeholder[type] = entry;
    if (definition.hasTable && definition.hasList) {
      throw new Error('Definitions cannot have both tables and lists at this time');
    }
    if (definition.hasTable) {
      entry.rows = [];
    }
    if (definition.hasList) {
      entry.listItems = [];
    }
  }
  if (definition.hasTable && definition.hasList) {
    throw new Error('Definitions cannot have both tables and lists at this time');
  }
  let listPropertiesName = null;
  if (definition.hasTable) {
    propertyName = 'rows';
    listPropertiesName = 'table';
  }
  if (definition.hasList) {
    propertyName = 'listItems';
    listPropertiesName = 'list';
  }

  if (!propertyName) {
    throw new Error('No definition items collection available');
  }

  const dest = placeholder[type][propertyName];
  dest.push(entityClone);

  const listProperties = definition[listPropertiesName];

  if (listProperties && (listProperties.groupBy || listProperties.sortBy)) {
    const sortBy = [
      dest,
    ];
    if (listProperties.groupBy) {
      sortBy.push(listProperties.groupBy);
    }
    if (listProperties.sortBy) {
      sortBy.push(listProperties.sortBy);
    }
    const after = _.sortBy.apply(null, sortBy);
    placeholder[type][propertyName] = after;
  }
}

function identityAdministratorsWithoutLinks(repositoryContext) {
  const actionableAdministrators = repositoryContext.actionableAdministrators;
  const administratorsByType = {
    linked: actionableAdministrators.filter(admin => {
      return admin.link;
    }),
    unlinked: actionableAdministrators.filter(admin => {
      return !admin.link;
    }),
  };
  repositoryContext.administratorsByType = administratorsByType;
  return Q(repositoryContext);
}

function justAdminTeams(teams) {
  return Q(teams.filter(team => {
    return team.permission === 'admin';
  }));
}

function justAdminCollaborators(collaborators) {
  return Q(collaborators.filter(collaborator => {
    return collaborator.permissions.admin;
  }));
}

function getRepositoryTeams(repository, cacheOptions) {
  const deferred = Q.defer();
  repository.getTeamPermissions(cacheOptions, (error, permissions) => {
    return error ? deferred.reject(error) : deferred.resolve(permissions);
  });
  return deferred.promise;
}

function getRepositoryDirectCollaborators(repository) {
  const deferred = Q.defer();
  const directCollaboratorOptions = {
    affiliation: 'direct',
    backgroundRefresh: true,
    maxAgeSeconds: 60 * 60 * 24, // full day allowed
  };
  repository.getCollaborators(directCollaboratorOptions, (error, collaborators) => {
    return error ? deferred.reject(error) : deferred.resolve(collaborators);
  });
  return deferred.promise;
}

function getRepos(context) {
  const deferred = Q.defer();
  const operations = context.operations;
  operations.getRepos((error, repos) => {
    if (error) {
      return deferred.reject(error);
    }
    context.entities.repos = repos.sort((a, b) => {
      return a.full_name.localeCompare(b.full_name, 'en', {'sensitivity': 'base'});
    });
    return deferred.resolve(context);
  });
  return deferred.promise;
}

function createUserEntry(basics) {
  return {
    login: basics.login,
    reasons: {
      memberships: [],
      directCollaborator: false,
    },
  };
}

function transformReasonsToArray(userEntry, repositoryName) {
  const reasons = [];
  // For efficiency reasons, direct collaborator wins over team memberships
  if (userEntry.reasons.directCollaborator) {
    reasons.push(`Administrator of the ${repositoryName} repository`);
  } else {
    for (let i = 0; i < userEntry.reasons.memberships.length; i++) {
      const team = userEntry.reasons.memberships[i];
      reasons.push(`Member of the ${team.name} team with administrator rights to the ${repositoryName} repository`);
    }
  }

  if (!reasons.length) {
    reasons.push(`Unknown reason related to the ${repositoryName}`);
  }
  return reasons;
}

function storeCollaborators(administrators, collaborators) {
  return Q.all(collaborators.map(collaborator => {
    const id = collaborator.id;
    let entry = administrators.get(id);
    if (!entry) {
      entry = createUserEntry(collaborator);
      administrators.set(id, entry);
    }
    entry.reasons.collaborator = true;
    return Q();
  }));
}

function buildReports(context) {
  return Q(context);
}

function consolidate(context) {
  // For any used definitions of a provider entity instance, add it to the generic report
  const consolidated = {
    definitions: [],
    entities: [],
  };

  for (let i = 0; i < definitions.length; i++) {
    const definition = definitions[i];
    if (!context.visitedDefinitions || !context.visitedDefinitions[providerName]) {
      return Q(context);
    }
    if (context.visitedDefinitions[providerName].has(definition.name)) {
      consolidated.definitions.push(definition);
    }
  }

  // Entities
  const sorted = _.sortBy(context.repositoryData, 'nameLowercase') ; // 'entityName'); // full_name groups by org name AND repo name naturally
  for (let i = 0; i < sorted.length; i++) {
    const fullEntity = sorted[i];
    const reducedEntity = {
      name: fullEntity.name,
    };
    const contextDirectProperties = [
      'issues',
      'recipients',
    ];
    cloneProperties(fullEntity, contextDirectProperties, reducedEntity);

    // Only store in the consolidated report if there are recipients for the entity
    const issueCounter = Object.getOwnPropertyNames(reducedEntity.issues);
    if (issueCounter && issueCounter.length && reducedEntity && reducedEntity.recipients && reducedEntity.recipients.length > 0) {
      consolidated.entities.push(reducedEntity);
    } else if (issueCounter && issueCounter.length) {
      console.warn(`There are no recipients to receive ${reducedEntity.name} reports with active issues`);
    }
  }
  context.consolidated[providerName] = consolidated;
  return Q(context);
}

function cloneProperties(source, properties, target) {
  for (let j = 0; j < properties.length; j++) {
    const property = properties[j];
    if (source[property]) {
      target[property] = source[property];
    }
  }
}

module.exports = {
  process: processRepositories,
  build: buildReports,
  consolidate: consolidate,
};
