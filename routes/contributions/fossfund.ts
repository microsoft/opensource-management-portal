//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import express from 'express';
import asyncHandler from 'express-async-handler';
const router = express.Router();

import { ReposAppRequest, IProviders, ErrorHelper } from '../../transitional';
import { FossFundElection, IElectionResultWithNominee } from '../../features/fossFundElection';
import { ElectionEntity } from '../../entities/voting/election';
import { UserSettings } from '../../entities/userSettings';

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
    return next();
  } catch (getElectionHelperError) {
    return next(getElectionHelperError);
  }
}));

router.get('/', asyncHandler(async (req: IFundRequest, res, next) => {
  const activeElections = await req.elections.getActiveElections();
  req.individualContext.webContext.render({
    view: 'contributions/voting/elections',
    title: `Elections`,
    state: {
      activeElections,
    },
  });
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

enum ElectionDisplayState {
  Voted = 'Voted',
  Vote = 'Vote',
  NotEligible = 'NotEligible',
}

router.get('/:electionid', asyncHandler(async (req: IFundRequest, res, next) => {
  const { election, elections } = req;
  const { userSettingsProvider } = req.app.settings.providers as IProviders;
  const electionId = election.electionId;
  const corporateId = req.individualContext.corporateIdentity.id;
  let userSettings: UserSettings = null;
  try {
    userSettings = await userSettingsProvider.getUserSettings(corporateId)
  } catch (noUserSettings) {
    if (ErrorHelper.IsNotFound(noUserSettings)) {
      userSettings = new UserSettings();
      userSettings.corporateId = corporateId;
      await userSettingsProvider.insertUserSettings(userSettings);
    }
  }
  let votingState = ElectionDisplayState.NotEligible;
  let ballot = null;
  let vote = await elections.hasVoted(corporateId, electionId);
  if (vote) {
    votingState = ElectionDisplayState.Voted;
  } else {
    try {
      const canVote = await elections.canVote(corporateId, electionId);
      if (canVote) {
        votingState = ElectionDisplayState.Vote;
        ballot = await elections.getBallot(electionId);
      }
    } catch (cannotVote) {
      // ok
    }
  }
  const showResults = votingState === ElectionDisplayState.Voted || votingState === ElectionDisplayState.NotEligible;
  let results = null;
  let totalVotes = 0;
  if (showResults) {
    results = await elections.getElectionResults(electionId);
    results.map((result: IElectionResultWithNominee) => {
      totalVotes += result.votes;
    });
  }
  return req.individualContext.webContext.render({
    view: 'contributions/voting/vote',
    title: req.election.title,
    state: {
      election,
      votingState,
      ballot,
      results,
      totalVotes,
      vote,
      userSettings,
    },
  });
}));

router.post('/:electionid', asyncHandler(async (req: IFundRequest, res, next) => {
  const { election, elections } = req;
  const corporateId = req.individualContext.corporateIdentity.id;
  const { nominationUniqueId } = req.body;
  if (!nominationUniqueId) {
    return next(new Error('No nomination selected'));
  }
  const electionId = election.electionId;
  const canVote = await elections.canVote(corporateId, electionId);
  if (!canVote) {
    return next(new Error('You are not able to vote in this election, sorry.'));
  }
  const isValidNominationUniqueId = await elections.getValidBallotNomination(electionId, nominationUniqueId);
  if (!isValidNominationUniqueId) {
    return next(new Error('Invalid nomination.'));
  }
  let voteId = null;
  try {
    voteId = await elections.vote(corporateId, electionId, isValidNominationUniqueId.nominationId);
  } catch (error) {
    return next(ErrorHelper.WrapError(error, 'Your vote could not be cast. Did you already vote?'));
  }
  return res.redirect(elections.getElectionUrl(election.slug) + '?v=' + voteId);
}));

export default router;
