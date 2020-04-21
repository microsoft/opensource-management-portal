//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { shuffle } from 'lodash';

import { IProviders, ErrorHelper } from '../transitional';
import { ElectionEntity, ElectionEligibilityType } from '../entities/voting/election';
import { ElectionNominationEntity, ElectionNominationEntityProvider } from '../entities/voting/nomination';
import { ElectionVoteEntity } from '../entities/voting/vote';
import { EventRecord } from '../entities/events/eventRecord';
import { asNumber } from '../utils';
import { GetAddressFromUpnAsync } from '../lib/mailAddressProvider';

export interface IFossBallot {
  election: ElectionEntity;
  nominees: ElectionNominationEntity[];
}

export interface IElectionResultWithNominee {
  votes: number;
  nomination: ElectionNominationEntity;
}

interface IContributionsDocument {
  contributions: EventRecord[];
}

export class FossFundElection {
  #providers: IProviders;

  constructor(providers: IProviders) {
    if (!providers.electionProvider) {
      throw new Error('No election providers configured.');
    }
    this.#providers = providers;
  }

  getElectionUrl(electionSlug: string) {
    return `/contributions/voting/${electionSlug}`;
  }

  getActiveElections(): Promise<ElectionEntity[]> {
    const { electionProvider} = this.#providers;
    return electionProvider.queryActiveElections();
  }

  getElectionsByEligibilityDates(start: Date, end: Date): Promise<ElectionEntity[]> {
    const { electionProvider} = this.#providers;
    return electionProvider.queryElectionsByEligibilityDates(start, end);
  }

  getElection(electionId: string): Promise<ElectionEntity> {
    return this.#providers.electionProvider.getElection(electionId);
  }

  async getElectionBySlug(electionSlug: string): Promise<ElectionEntity> {
    const elections = await this.#providers.electionProvider.queryElectionBySlug(electionSlug);
    if (elections.length === 0) {
      throw new Error('The election is not found.');
    } else if (elections.length > 1) {
      throw new Error('Too many elections may be configured.');
    }
    return elections[0];
  }

  getAllNominations(electionId: string): Promise<ElectionNominationEntity[]> {
    return this.#providers.electionNominationProvider.queryAllElectionNominees(electionId);
  }

  async getBallot(electionId: string): Promise<IFossBallot> {
    const election = await this.#providers.electionProvider.getElection(electionId);
    const nominees = shuffle(await this.#providers.electionNominationProvider.queryApprovedElectionNominees(electionId));
    return { election, nominees };
  }

  async canNominate(corporateId: string, electionId: string): Promise<boolean> {
    let election: ElectionEntity = null;
    try {
      election = await this.getElection(electionId);
    } catch (electionError) {
      throw ErrorHelper.WrapError(electionError, 'The election does not exist.');
    }
    const now = new Date();
    if (election.nominationEnd && election.nominationEnd < now) {
      throw new Error(`Nominations are closed for the ${election.title} election. Nominations closed ${election.nominationEnd}.`);
    }
    if (election.nominationStart && election.nominationStart > now) {
      throw new Error(`The nomination period has not yet opened for the ${election.title} election. The nomination period should open ${election.nominationStart}.`);
    }
    const hasNominated = await this.hasNominated(corporateId, electionId);
    if (hasNominated) {
      throw new Error('You have already made a nomination.');
    }
    const eligible = await this.checkNominationEligibility(corporateId, electionId);
    if (!eligible) {
      throw new Error('You are not eligible to nominate in this election.');
    }
    return true;
  }

  async createNomination(corporateId: string, electionId: string): Promise<string> {
    // TODO: Not implemented yet.
    throw ErrorHelper.NotImplemented();
  }

  async checkNominationEligibility(corporateId: string, electionId: string): Promise<boolean> {
    const { eligibilityType, nominationStart, nominationEnd } = await this.getElection(electionId);
    if (eligibilityType !== ElectionEligibilityType.OpenSourceContributions) {
      throw new Error(`The election system is not configured to validate eligibility of type ${eligibilityType}`);
    }
    return this.hasOpenEvents(corporateId, nominationStart, nominationEnd);
  }

  async getValidBallotNomination(electionId: string, uniqueNominationId: string): Promise<ElectionNominationEntity> {
    let election: ElectionEntity = null;
    try {
      election = await this.getElection(electionId);
    } catch (electionError) {
      throw ErrorHelper.WrapError(electionError, 'The election does not exist.');
    }
    const { electionNominationProvider } = this.#providers;
    const choices = await electionNominationProvider.queryApprovedElectionNominees(election.electionId);
    const choice = choices.filter(c => c.uniqueId === uniqueNominationId);
    if (choice.length !== 1) {
      return null;
    }
    return choice[0];
  }

  async hasNominated(corporateId: string, electionId: string): Promise<boolean> {
    const { electionNominationProvider } = this.#providers;
    try {
      const nominationId = ElectionNominationEntity.GetNominationId(corporateId, electionId);
      const nomination = await electionNominationProvider.getNomination(nominationId);
      return true;
    } catch (findNominationError) {
      if (ErrorHelper.IsNotFound(findNominationError)) {
        return false;
      }
      throw findNominationError;
    }
  }

  async checkVotingEligibility(corporateId: string, electionId: string): Promise<boolean> {
    // Are they a registered or eligible voter? Does not take into account other edge cases.
    const { eligibilityType, eligibilityStart, eligibilityEnd } = await this.getElection(electionId);
    if (eligibilityType !== ElectionEligibilityType.OpenSourceContributions) {
      throw new Error(`The election system is not configured to validate eligibility of type ${eligibilityType}`);
    }
    return await this.hasOpenEvents(corporateId, new Date(eligibilityStart), new Date(eligibilityEnd));
  }
  
  private async hasOpenEvents(corporateId: string, start: Date, end: Date): Promise<boolean> {
    const { cacheProvider, eventRecordProvider } = this.#providers;
    const key = `contributions:open:corp:${corporateId}:${start.toISOString()}:${end.toISOString()}`;
    if (cacheProvider) {
      let contributions = await cacheProvider.getObject(key) as IContributionsDocument;
      if (contributions) {
        return true;
      }
    }
    const records  = await eventRecordProvider.queryOpenContributionEventsByDateRangeAndCorporateId(
      corporateId,
      start,
      end,
      true);
    const ttlMinutes = 60 * 24;
    if (cacheProvider) {
      await cacheProvider.setObjectWithExpire(key, { contributions: records }, ttlMinutes);
    }
    return !!records.length;
  }

  async canVote(corporateId: string, electionId: string): Promise<boolean> {
    let election: ElectionEntity = null;
    try {
      election = await this.getElection(electionId);
    } catch (electionError) {
      throw ErrorHelper.WrapError(electionError, 'The election does not exist.');
    }
    if (!election.active) {
      throw new Error('The election is not currently active.');
    }
    const now = new Date();
    if (election.votingEnd && election.votingEnd < now) {
      throw new Error(`Voting is not longer open for the ${election.title} election. Voting closed ${election.votingEnd}.`);
    }
    if (election.votingStart && election.votingStart > now) {
      throw new Error(`Voting has not yet opened for the ${election.title} election. Voting should open ${election.votingStart}.`);
    }
    const hasVoted = await this.hasVoted(corporateId, electionId);
    if (hasVoted) {
      throw new Error('You have already voted.');
    }
    const eligible = await this.checkVotingEligibility(corporateId, electionId);
    if (!eligible) {
      return false;
      // throw new Error('You are not eligible to vote in this election.');
    }
    return true;
  }

  async hasVoted(corporateId: string, electionId: string): Promise<ElectionVoteEntity> {
    const { electionVoteProvider } = this.#providers;
    try {
      const voteId = ElectionVoteEntity.GetVoteId(electionId, corporateId);
      const vote = await electionVoteProvider.getVote(voteId);
      return vote;
    } catch (voteError) {
      if (ErrorHelper.IsNotFound(voteError)) {
        return null;
      }
      throw voteError;
    }
  }

  async getElectionResults(electionId: string): Promise<IElectionResultWithNominee[]> {
    const { electionNominationProvider, electionVoteProvider } = this.#providers;
    const nominees = await electionNominationProvider.queryApprovedElectionNominees(electionId);
    const nomineeMap = new Map();
    for (const nominee of nominees) {
      nomineeMap.set(nominee.nominationId, nominee);
    }
    const results = await electionVoteProvider.currentElectionResults(electionId);
    const currentResults: IElectionResultWithNominee[] = [];
    const visitedNominees = new Set();
    results.map(result => {
      visitedNominees.add(result.nominationId);
      const nomination = nomineeMap.get(result.nominationId);
      if (nomination) {
        currentResults.push({
          votes: result.votes ? asNumber(result.votes) : 0,
          nomination: nomineeMap.get(result.nominationId),
        });
      } else {
        console.log(`warning: a vote was present for a nomination ${result.nominationId} that is no longer a valid nominee`);
      }
    });
    nominees.map(nomination => {
      if (!visitedNominees.has(nomination.nominationId)) {
        currentResults.push({
          nomination,
          votes: 0,
        });
      }
    });
    return currentResults;
  }

  async vote(corporateId: string, electionId: string, nominationId: string): Promise<string> {
    // Simply casts a vote.
    // DOES NOT verify eligibility for the election or whether the nomination is valid.
    // IMPORTANT: the nominationId is not the same thing as the unique nomination ID.
    const { electionVoteProvider } = this.#providers;
    const entity = ElectionVoteEntity.CreateVote(corporateId, electionId);
    entity.nominationId = nominationId;
    try {
      const voteId = await electionVoteProvider.insertVote(entity);
      this.trySendingVoteMails(corporateId, electionId); // do not await this...
      return voteId;
    } catch (insertVoteError) {
      // TODO: Verify if Conflict works with pgsql.
      if (ErrorHelper.IsConflict(insertVoteError)) {
        throw ErrorHelper.WrapError(insertVoteError, 'You\'ve already cast your vote in this election.');
      }
      throw insertVoteError;
    }
  }

  async trySendingVoteMails(corporateId: string, electionId: string) {
    const { config, electionProvider, insights, linkProvider, mailAddressProvider, electionNominationProvider, electionVoteProvider, operations } = this.#providers;
    try {
      const link = (await linkProvider.queryByCorporateId(corporateId))[0];
      const election = await electionProvider.getElection(electionId);
      const mailAddress = await GetAddressFromUpnAsync(mailAddressProvider, link.corporateUsername);
      const vote = await electionVoteProvider.getVote(ElectionVoteEntity.GetVoteId(electionId, corporateId));
      const nomination = await electionNominationProvider.getNomination(vote.nominationId);
      let content = await operations.emailRender('vote', {
        election,
        link,
        vote,
        nomination,
        mailToVoter: true,
        reason: `You voted in the election as ${link.corporateUsername}. This is your record of the transaction, sent to ${mailAddress}.`,
        headline: 'Thanks',
        notification: 'information',
        app: `${config.brand?.companyName} FOSS Fund`,
      });
      await operations.sendMail({
        to: mailAddress,
        subject: `You voted for ${nomination.title} in ${election.title}`,
        content,
      });
      const electionMail = config.brand?.electionMail;
      if (electionMail) {
        content = await operations.emailRender('vote', {
          election,
          link,
          vote,
          nomination,
          mailToOperations: true,
          reason: `Sent to operations at ${electionMail}. The corporate user ${link.corporateUsername} voted in ${election.title}. This is the vote record for operations. A mail was also sent to ${mailAddress}.`,
          headline: 'Vote record',
          notification: 'information',
          app: `${config.brand?.companyName} FOSS Fund`,
        });
        await operations.sendMail({
          to: electionMail,
          subject: `Vote for ${nomination.title} by ${link.corporateUsername} in ${election.title}`,
          content,
        });
      }
    } catch (exception) {
      console.dir(exception);
      if (insights) {
        insights.trackException( { exception });
      }
    }
  }
}
