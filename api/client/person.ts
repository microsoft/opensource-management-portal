//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import asyncHandler from 'express-async-handler';
import { ReposAppRequest, AccountJsonFormat } from '../../interfaces';
import { IGraphEntry } from '../../lib/graphProvider';

import { jsonError } from '../../middleware';
import { getProviders } from '../../transitional';

export default asyncHandler(async (req: ReposAppRequest, res, next) => {
  const providers = getProviders(req);
  const { operations, queryCache, graphProvider } = providers;
  const login = req.params.login as string;
  let corporateEntry: IGraphEntry = null;
  try {
    const account = await operations.getAccountByUsername(login);
    const idAsString = String(account.id);
    await account.tryGetLink();
    try {
      if (graphProvider && account.link?.corporateId) {
        corporateEntry = await graphProvider.getUserById(account.link.corporateId);
      }
    } catch (ignoreError) {
      //
    }
    const json = account.asJson(AccountJsonFormat.GitHubDetailedWithLink);
    const orgs = await queryCache.userOrganizations(idAsString);
    const teams = await queryCache.userTeams(idAsString);
    for (let team of teams) {
      if (!team.team.slug) {
        try {
          await team.team.getDetails();
        } catch (ignoreSlugError) {
          console.warn(`get team slug or details error: team ID=${team.team.id} error=${ignoreSlugError}`);
        }
      }
    }
    const collabs = await queryCache.userCollaboratorRepositories(idAsString);
    const combined = Object.assign(
      {
        orgs: orgs.map((o) => {
          return {
            organization: o.organization.name,
            role: o.role,
            organizationId: o.organization.id,
          };
        }),
        teams: teams.map((t) => {
          return {
            role: t.role,
            slug: t.team.slug,
            organization: t.team.organization.name,
            teamId: t.team.id,
          };
        }),
        collaborator: collabs.map((c) => {
          return {
            affiliation: c.affiliation,
            permission: c.permission,
            organization: c.repository.organization.name,
            repository: c.repository.name,
            repositoryId: c.repository.id,
            private: c.repository.private,
          };
        }),
      },
      json,
      { corporateEntry }
    );
    return res.json(combined);
  } catch (error) {
    return next(jsonError(`login ${login} error: ${error}`, 500));
  }
});
