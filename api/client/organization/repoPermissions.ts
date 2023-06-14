//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response, Router } from 'express';
import asyncHandler from 'express-async-handler';

import { jsonError } from '../../../middleware/jsonError';
import { ReposAppRequest } from '../../../interfaces';
import { Repository } from '../../../business/repository';
import { findRepoCollaboratorsExcludingOwners } from '../../../routes/org/repos';

type RequestWithRepo = ReposAppRequest & {
  repository: Repository;
};

const router: Router = Router();

router.get(
  '/',
  asyncHandler(async (req: RequestWithRepo, res: Response, next: NextFunction) => {
    const { repository, organization } = req;
    try {
      const teamPermissions = await repository.getTeamPermissions();
      const owners = await organization.getOwners();
      const { collaborators, outsideCollaborators, memberCollaborators } =
        await findRepoCollaboratorsExcludingOwners(repository, owners);
      for (const teamPermission of teamPermissions) {
        try {
          teamPermission.resolveTeamMembers();
        } catch (ignoredError) {
          /* ignored */
        }
      }
      return res.json({
        teamPermissions: teamPermissions.map((tp) => tp.asJson()),
        collaborators: collaborators.map((c) => c.asJson()),
        outsideCollaborators: outsideCollaborators.map((oc) => oc.asJson()),
        memberCollaborators: memberCollaborators.map((oc) => oc.asJson()),
      }) as unknown as void;
    } catch (error) {
      return next(jsonError(error));
    }
  })
);

export default router;
