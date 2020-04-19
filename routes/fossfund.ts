//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// NEXT STEPS FOR FOSS FUNDING LAUNCH:
// - email template and logic code for sending acknowledgements to person + BCC ops
// - integrate logic and routes into the contributions area
// - design the page/form
// - finalize the entities by adding github and other project field areas

// contributions/fund/     show available, open elections
//                   /electionid/
//                              /nominate
//                              /vote
//                              /results
//                              /administer

import express from 'express';
import asyncHandler from 'express-async-handler';
import { ReposAppRequest, IProviders } from '../transitional';
import { FossFundElection } from '../features/fossFundElection';
import { ElectionEntity } from '../entities/voting/election';
const router = express.Router();

interface IFundRequest extends ReposAppRequest {
  providers: IProviders;
  elections: FossFundElection;

  election?: ElectionEntity;
}

router.use('/', asyncHandler(async (req: IFundRequest, res, next) => {
  const providers = req.app.settings.providers as IProviders;
  req.providers = providers;
  try {
    req.elections = new FossFundElection(providers);
  } catch (getElectionHelperError) {
    return next(getElectionHelperError);
  }
}));

router.get('/', asyncHandler(async (req: IFundRequest, res, next) => {
  const activeElections = await req.elections.getActiveElections();
  res.send(activeElections);
}));

router.use('/:electionSlug', asyncHandler(async (req: IFundRequest, res, next) => {
  const { electionSlug } = req.params;
  try {
    req.election = await req.elections.getElectionBySlug(electionSlug);
    return next();
  } catch (error) {
    return next(error);
  }
}));

router.get('/:electionid', asyncHandler(async (req: IFundRequest, res, next) => {
  res.send(req.election.title);
  console.dir(req.election);
}));

export default router;
