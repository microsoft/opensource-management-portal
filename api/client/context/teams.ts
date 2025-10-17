//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { NextFunction, Response } from 'express';

import { ReposAppRequest, TeamJsonFormat } from '../../../interfaces/index.js';
import { IndividualContext } from '../../../business/user/index.js';

export default async (req: ReposAppRequest, res: Response, next: NextFunction) => {
  const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
  if (!activeContext.link) {
    return res.json({
      isLinked: false,
      member: [],
      maintainer: [],
    }) as unknown as void;
  }
  const permissions = await activeContext.aggregations.getQueryCacheTeams();
  return res.json({
    isLinked: true,
    member: permissions.member.map((t) => t.asJson(TeamJsonFormat.Augmented)),
    maintainer: permissions.maintainer.map((t) => t.asJson(TeamJsonFormat.Augmented)),
  }) as unknown as void;
};
