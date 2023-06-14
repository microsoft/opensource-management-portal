//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';
import asyncHandler from 'express-async-handler';

import { GitHubRepositoryPermission, ReposAppRequest } from '../../../interfaces';
import { IndividualContext } from '../../../business/user';

export default asyncHandler(async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  try {
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    if (!activeContext.link) {
      return res.json({
        isLinked: false,
        repositories: [],
      }) as unknown as void;
    }
    let permissions = await activeContext.aggregations.getQueryCacheRepositoryPermissions();
    permissions = permissions.filter((perm) => {
      if (perm.bestComputedPermission !== GitHubRepositoryPermission.Pull) {
        return true;
      }
      let fromBroadAccess = false;
      perm.teamPermissions.map((tp) => {
        if (tp.team.isBroadAccessTeam) {
          fromBroadAccess = true;
        }
      });
      if (fromBroadAccess) {
        return false;
      }
      if (perm.repository.private) {
        return true;
      }
      return false;
    });
    return res.json({
      isLinked: true,
      repositories: permissions.map((perm) => {
        return {
          bestComputedPermission: perm.bestComputedPermission,
          collaboratorPermission: perm.collaboratorPermission,
          repository: perm.repository.asJson(),
          teamPermissions: perm.teamPermissions.map((tp) => tp.asJson()),
          // TODO: would be nice for team permission for repos to also store the team slug in the query cache!
        };
      }),
    }) as unknown as void;
  } catch (error) {
    return next(error);
  }
});
