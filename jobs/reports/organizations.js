//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

/* eslint no-console: ["error", { allow: ["warn", "dir", "log"] }] */

'use strict';

const async = require('async');
const Q = require('q');
const qlimit = require('qlimit');

const providerName = 'organizations';
const definitions = require('./organizationDefinitions.json');
const definitionsByName = {};
for (let i = 0; i < definitions.length; i++) {
  const definition = definitions[i];
  definitionsByName[definition.name] = definition;
}

function filterOrganizationAdministrators(context, organizationContext, administrators) {
  const limit = qlimit(1);
  organizationContext.administratorsByType = {
    linked: [],
    unlinked: [],
    serviceAccounts: [],
    serviceAccountsNoMail: [],
  };
  if (administrators && !administrators.map && administrators.get) {
    administrators = Array.from(administrators.values());
  }
  if (!administrators || !administrators.map) {
    return Q.resolve([]);
  }
  return Q.all(administrators.map(limit(admin => {
    return getIndividualUserLink(context, admin.id).then(link => {
      const spot = organizationContext.administratorsByType[link ? 'linked' : 'unlinked'];
      admin.link = link;
      spot.push(admin);
      if (link && link.serviceAccount) {
        (organizationContext.administratorsByType[link.serviceAccountMail ? 'serviceAccounts' : 'serviceAccountsNoMail' ]).push(admin);
      }
    });
  }))).thenResolve(administrators);
}

function getIndividualUserLink(context, id) {
  if (!context.linkData) {
    throw new Error('No link information has been loaded');
  }
  return Q(context.linkData.get(id));
}

function ensureAllUserLinks(context, operations) {
  const deferred = Q.defer();

  const latestDataOptions = {
    includeNames: true,
    includeId: true,
    includeServiceAccounts: true,
    maxAgeSeconds: 0,
    backgroundRefresh: false,
  };

  operations.getLinks(latestDataOptions, (error, links) => {
    if (error) {
      return deferred.reject(error);
    }
    const set = new Map();
    for (let i = 0; i < links.length; i++) {
      const id = links[i].ghid;
      if (id) {
        set.set(parseInt(id, 10), links[i]);
      }
    }
    context.linkData = set;
    deferred.resolve();
  });
  return deferred.promise;
}

function process(context) {
  const operations = context.operations;
  return ensureAllUserLinks(context, operations).then(() => {
    return getOrganizationData(context);
  });
}

function getReasonForRecipient(adminEntry, orgName) {
  let reason = `Unknown reason for receiving this report in the ${orgName} organization`;
  if (adminEntry.owner && adminEntry.sudo) {
    reason = `Organization owner of ${orgName} with portal sudo rights`;
  } else if (adminEntry.owner) {
    reason = `Organization owner of ${orgName}`;
  } else if (adminEntry.sudo) {
    reason = `Member of the ${orgName} organization with sudo privileges`;
  }
  return reason;
}

function getOrganizationData(context) {
  const operations = context.operations;
  const names = operations.getOrganizationOriginalNames().sort((a, b) => { return a.localeCompare(b, 'en', {'sensitivity': 'base'});});
  const limit = qlimit(1);

  return Q.all(names.map(limit(orgName => {
    const organization = operations.organizations[orgName.toLowerCase()];
    if (!organization) {
      return Q.reject(new Error(`Cannot locate ${orgName} at runtime`));
    }
    if (!context.organizationData[orgName]) {
      context.organizationData[orgName] = {};
    }
    // Organization context
    const organizationContext = {
      organization: organization,
      issues: {},
      definitionsUsed: new Set(),
    };
    const data = context.organizationData[orgName];
    data.organizationContext = organizationContext;
    return getOrganizationAdministrators(organization)
      .then(filterOrganizationAdministrators.bind(null, context, organizationContext))
      .then(admins => {
        data.administrators = admins;
        return ensureGitHubFullNames(context, admins);
      }).then(getUnlinkedOrganizationMembers.bind(null, context, organization))
      .then(unlinkedMembers => {
        data.unlinkedMembers = unlinkedMembers;
        return ensureGitHubFullNames(context, unlinkedMembers);
      })
      .then(() => {
        // Configured private engineering org message
        if (organization.privateEngineering) {
          addOrganizationWarning(context, organizationContext, `Private engineering happens in the ${organization.name} GitHub organization. Consider an approved internal engineering system. This report is designed to help drive visibility for organizations involved in open source work on GitHub.com. As a result, some of the wording may not be appropriate for private engineering scenarios. Do share any feedback with the team. The repository-specific reports are only provided to org owners in this scenario.`);
        }

        // Configured "open source", external members org message
        if (organization.externalMembersPermitted) {
          addOrganizationWarning(context, organizationContext, `External members permitted: Your org, ${organization.name}, may permit members who are not linked. While most organizations require that all members have links, this org may be special. In the short term please identify employees and ask them to link their accounts. Longer term, this alert can be removed for this organization to reduce any noise. Please send feedback and your preferences in this space to opensource@microsoft.com.`);
        }

        // Org issue: unlinked owners or sudo users (administrators)
        const adminsByType = organizationContext.administratorsByType;
        if (adminsByType.unlinked.length) {
          addOrganizationWarning(context, organizationContext, `This organization has ${adminsByType.unlinked.length} unlinked owners`);
        }

        const recipients = [];
        if (adminsByType.linked.length) {
          for (let i = 0; i < adminsByType.linked.length; i++) {
            const adminEntry = adminsByType.linked[i];
            const link = adminEntry.link;
            if (link.serviceAccountMail) {
              // Mails are only being sent to actual linked accounts at this time
              /*
              contactMethod = {
                type: 'mail',
                value: link.serviceAccountMail,
              };
              */
            } else if (link.aadupn) {
              const contactMethod = {
                type: 'upn',
                value: link.aadupn,
                reasons: [getReasonForRecipient(adminEntry, orgName)],
              };
              recipients.push(contactMethod);
            } else {
              return Q.reject(new Error(`Unable to identify the proper contact method for a linked administrator in the ${orgName} org`));
            }
          }
        }
        organizationContext.recipients = recipients;

        // Org issue: too many owners
        const owners = data.administrators.filter(member => { return member.owner; });
        data.owners = owners;

        // Review owners
        const systemAccountOwnerUsernames = new Set(context.config && context.config.github && context.config.github.systemAccounts ? context.config.github.systemAccounts.logins : []);
        const standardOwners = owners.filter(owner => { return !systemAccountOwnerUsernames.has(owner.login); });
        const systemAccountOwners = owners.filter(owner => { return systemAccountOwnerUsernames.has(owner.login); });
        ownerBucket('reviewOwners', standardOwners);
        ownerBucket('reviewSystemOwners', systemAccountOwners);

        const tooMany = context.settings.tooManyOrgOwners || 5;
        if (standardOwners.length > tooMany) {
          addOrganizationWarning(context, organizationContext, `This organization has too many owners, increasing the chance of data loss, configuration problems and improper use of team permissions. Please limit the organization to under ${tooMany} direct owners.`);
        }

        // Review sudoers
        const sudoers = data.administrators.filter(member => { return member.sudo && !member.owner && !systemAccountOwnerUsernames.has(member.login); });
        data.sudoers = sudoers;
        ownerBucket('reviewSudoers', sudoers);

        function ownerBucket(definitionName, list) {
          // Do not prepare this report type if it is empty
          if (!list || !list.length) {
            return;
          }
          const bucket = getOrganizationIssuesType(context, organizationContext, definitionName);
          for (let x = 0; x < list.length; x++) {
            const ownerEntry = Object.assign({
              name: orgName,
            }, list[x]);

            // Role
            let role = 'Unknown';
            const roles = [];
            if (ownerEntry.owner) {
              roles.push('Owner');
            }
            if (ownerEntry.sudo) {
              roles.push('Sudo owner');
            }
            if (ownerEntry.link && ownerEntry.link.serviceAccount) {
              roles.push('Service account');
            }
            if (roles.length > 0) {
              role = roles.join(', ');
            }
            ownerEntry.role = role;

            // Actions
            ownerEntry.actions = {
              actions: [
                {
                  text: 'Change role',
                  link: `https://github.com/orgs/${orgName}/people?query=${ownerEntry.login}`,
                },
              ],
            };

            // Link information
            let fullName = null;
            let corporateId = null;
            if (ownerEntry.link) {
              fullName = ownerEntry.link.aadname || ownerEntry.link.aadupn;
              corporateId = ownerEntry.link.aadupn;
              if (ownerEntry.link.serviceAccount && ownerEntry.link.serviceAccountMail) {
                fullName = {
                  link: 'mailto:' + ownerEntry.link.serviceAccountMail,
                  text: fullName,
                };
              }
            } else {
              fullName = {
                color: 'red',
                text: 'Not linked',
              };
              corporateId = fullName;
              ownerEntry.actions.actions.push({
                link: `https://github.com/${ownerEntry.login}`,
                text: 'View profile',
              });
              ownerEntry.actions.actions.push({
                text: 'Remove',
                link: `https://github.com/orgs/${orgName}/people?query=${ownerEntry.login}`,
              });
              ownerEntry.actions.actions.push(createAskToLinkAction(ownerEntry));
            }
            ownerEntry.fullName = fullName;
            ownerEntry.corporateId = corporateId;
            bucket.rows.push(ownerEntry);
          }
        }
      }).then(() => {
        // Unlinked members
        if (data.unlinkedMembers.length) {
          addOrganizationWarning(context, organizationContext, `This organization has ${data.unlinkedMembers.length} unlinked members`);
          const bucket = getOrganizationIssuesType(context, organizationContext, 'unlinkedMembers');
          for (let x = 0; x < data.unlinkedMembers.length; x++) {
            const unlinked = Object.assign({}, data.unlinkedMembers[x]);
            unlinked.actions = {
              actions: [
                {
                  link: `https://github.com/${unlinked.login}`,
                  text: 'Review profile',
                },
                {
                  text: 'Remove',
                  link: `https://github.com/orgs/${orgName}/people?query=${unlinked.login}`,
                },
                createAskToLinkAction(unlinked),
              ],
            };
            bucket.rows.push(unlinked);
          }
        }
      }).then(() => {
        return getOrganizationDetails(organization).then(info => {
          data.info = info;

          const fixMemberPrivilegesActions = [
            {
              link: `https://github.com/organizations/${orgName}/settings/member_privileges`,
              text: 'Reduce member privileges',
            }
          ];
          const fixOrganizationProfileActions = [
            {
              link: `https://github.com/organizations/${orgName}/settings/profile`,
              text: 'Edit organization profile',
            }
          ];
          const cleanupRepoActions = [
            {
              link: `https://github.com/${orgName}`,
              text: 'Cleanup old repositories',
            }
          ];

          // Org issue: members can create repositories
          if (info.members_can_create_repositories) {
            addOrganizationWarning(context, organizationContext, {
              text: 'This organization allows members to directly create repositories on GitHub.com',
              actions: fixMemberPrivilegesActions,
            });
          }

          // Org issue: no org e-mail
          if (!info.email) {
            addOrganizationWarning(context, organizationContext, {
              text: 'No e-mail address has been provided for any public questions about your organization',
              actions: fixOrganizationProfileActions,
            });
          }

          // Org issue: no description
          if (!info.description) {
            addOrganizationWarning(context, organizationContext, {
              text: 'No organization description is provided',
              actions: fixOrganizationProfileActions,
            });
          }

          // Org issue: members all get admin or write access
          if (info.default_repository_permission === 'write') {
            addOrganizationWarning(context, organizationContext, {
              text: 'All organization members receive permission to directly commit to all repos as well as accept pull requests.',
              actions: fixMemberPrivilegesActions,
            });
          } else if (info.default_repository_permission === 'admin') {
            addOrganizationWarning(context, organizationContext, {
              text: 'All organization members receive administrative access to all repos. This practice is strongly discouraged.',
              actions: fixMemberPrivilegesActions,
            });
          }

          // Org issue: private repo utilization rate
          const tooFewPrivateRepos = context.settings.orgPercentAvailablePrivateRepos || 0.25;
          if (info.plan && info.plan.private_repos) {
            const privateCap = info.plan.private_repos * (1 - tooFewPrivateRepos);
            if (info.owned_private_repos > privateCap) {
              const availablePrivateRepos = info.plan.private_repos - info.owned_private_repos;
              addOrganizationWarning(context, organizationContext, {
                text: `Private repos are running out: ${availablePrivateRepos} available out of plan limit of ${info.plan.private_repos}.`,
                color: 'red',
                actions: cleanupRepoActions,
              });
            }
          }
        });
      });
  }))).catch(error => {
    console.log('Organizations error:');
    console.warn(error);
    throw error;
  }).then(() => {
    return Q(context);
  });
}

function getOrganizationDetails(organization) {
  const deferred = Q.defer();
  organization.getDetails((error, details) => {
    return error ? deferred.reject(error) : deferred.resolve(details);
  });
  return deferred.promise;
}

function createAskToLinkAction(entry) {
  if (entry.githubMail) {
    return {
      link: `mailto:${entry.githubMail}?subject=Please%20link&body=Please%20link%20your%20account%20at%20https://opensource.microsoft.com/link`,
      text: `Ask ${entry.githubMail} to link`,
    };
  } else {
    return {
      link: 'mailto:?subject=Please%20link&body=You%20will%20need%20to%20find%20an%20e-mail%20address%20to%20this%20person.%20Tell%20them:%20Link%20your%20account%20at%20https://opensource.microsoft.com/link',
      text: 'Ask to link',
    };
  }
}

function getUnlinkedOrganizationMembers(context, organization) {
  const deferred = Q.defer();
  // const operations = context.operations;
  const unlinked = [];
  organization.getMembers((error, members) => {
    if (error) {
      return deferred.reject(error);
    }
    async.eachLimit(members, 4, (member, next) => {
      getIndividualUserLink(context, member.id).then(link => {
        if (!link) {
          unlinked.push(member);
        }
        return next();
      }, next);
    }, error => {
      return error ? deferred.reject(error) : deferred.resolve(unlinked);
    });
  });
  return deferred.promise;
}

function getOrganizationAdministrators(organization) {
  const deferred = Q.defer();
  organization.getOrganizationAdministrators((error, admins) => {
    return error ? deferred.reject(error) : deferred.resolve(admins);
  });
  return deferred.promise;
}

function addOrganizationWarning(context, organizationContext, warning) {
  const holder = getOrganizationIssuesType(context, organizationContext, 'warnings').listItems;
  const type = typeof(warning);
  for (let i = 0; i < holder.length; i++) {
    const current = holder[i];
    if (type === typeof(current)) {
      // Do not add a duplicate
      if (type === 'object' && warning.text && warning.text === current.text) {
        return;
      } else if (warning === current) {
        return;
      }
    }
  }
  holder.push(warning);
}

function getOrganizationIssuesType(context, organizationContext, type) {
  const definition = definitionsByName[type];
  if (!definition) {
    throw new Error(`No defined issue type ${type}`);
  }

  // Track that the definition was used provider-wide and per-entity
  organizationContext.definitionsUsed.add(type);
  if (!context.visitedDefinitions[providerName]) {
    context.visitedDefinitions[providerName] = new Set();
  }
  context.visitedDefinitions[providerName].add(type);

  // Return the issue placeholder
  const placeholder = organizationContext.issues;
  if (!placeholder[type]) {
    const entry = {};
    placeholder[type] = entry;
    if (definition.hasTable) {
      entry.rows = [];
    }
    if (definition.hasList) {
      entry.listItems = [];
    }
  }
  return placeholder[type];
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
  const orgNames = Object.getOwnPropertyNames(context.organizationData);
  for (let i = 0; i < orgNames.length; i++) {
    const name = orgNames[i];
    const fullEntity = context.organizationData[name];
    const reducedEntity = {
      name: name,
    };

    const contextDirectProperties = [
      'issues',
      'recipients',
    ];
    cloneProperties(fullEntity.organizationContext, contextDirectProperties, reducedEntity);

    // Only store in the consolidated report if there are recipients for the entity
    let issueCount = 0;
    let recipientCount = reducedEntity && reducedEntity.recipients ? reducedEntity.recipients.length : 0;
    if (reducedEntity && reducedEntity.issues) {
      issueCount = Object.getOwnPropertyNames(reducedEntity.issues);
    }
    if (issueCount && recipientCount) {
      consolidated.entities.push(reducedEntity);
    } else {
      console.warn(`There are ${recipientCount} recipients to receive ${issueCount} issues from ${name} reports - not actionable`);
    }
  }

  context.consolidated[providerName] = consolidated;

  return Q(context);
}

function getGitHubAccount(operations, entity) {
  const deferred = Q.defer();
  const cachingOptions = {
    backgroundRefresh: true,
    maxAgeSeconds: 60 * 60 * 24 * 5 /* 5 days */,
  };
  operations.getAccount(entity.id).getDetails(cachingOptions, (error, details) => {
    if (details) {
      entity.githubFullName = details.name;
      entity.githubMail = details.email;
    }
    return error ? deferred.reject(error) : deferred.resolve();
  });
  return deferred.promise;
}

function ensureGitHubFullNames(context, entities) {
  const limit = qlimit(4);
  const operations = context.operations;
  const accountCall = getGitHubAccount.bind(null, operations);
  return Q.allSettled(entities.map(limit(accountCall)))
    .thenResolve(context);
  // Settled rejections cause no side effects at this time
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
  process: process,
  build: buildReports,
  consolidate: consolidate,
};
