//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import _ from 'lodash';
import { Operations } from '../operations';
import { SettleToStateValue, ISettledValue, SettledState } from '../../transitional';

const LinkManager = require('./linkManager');

export class UserContext {
  private _operations: Operations;
  private _linkManager: any;

  public id: number;

  constructor(operations: Operations, id: string | number) {
    this.id = typeof(id) === 'string' ? parseInt(id, 10) : id;

    this._operations = operations;
  }

  get linkManager() {
    if (!this._linkManager) {
      this._linkManager = new LinkManager(this._operations, this);
    }
    return this._linkManager;
  }

  // ------------------------------ Views -------------------------------------
  // These "views" may eventually need to be a little crisper/cleaner
  // --------------------------------------------------------------------------

  async getAggregatedOrganizationOverview(orgName: string): Promise<any> {
    const results = await this.getAggregatedOverview();
    const lco = orgName.toLowerCase();
    const removeOtherTeams = team => {
      return team.organization.login.toLowerCase() !== lco;
    };
    _.remove(results.teams.member, removeOtherTeams);
    _.remove(results.teams.maintainer, removeOtherTeams);
    // At this time it does not simplify or reduce repo lists or the general orgs list
    return results;
  }

  async getAggregatedOverview(): Promise<any> {
    let [ orgNames, orgStatuses, orgOwners, /*myTeams, myTeamMaintainers, repoTeams*/ ] = await Promise.all([
      SettleToStateValue(this.getOrganizationNames()),
      SettleToStateValue(this.getOrganizationStatuses()),
      SettleToStateValue(this.getOrganizationStatuses('admin')),
      // SettleToStateValue(this.getTeamMemberships()),
      // SettleToStateValue(this.getTeamMemberships('maintainer')),
      // SettleToStateValue(this.getRepoTeams()),
    ]);
    const errors = promisesToErrors(orgNames, orgStatuses, orgOwners, /*myTeams, myTeamMaintainers, repoTeams*/);
    const organizationNames = promiseResultToObject(orgNames);
    const results = {
      organizations: {
        member: promiseResultToObject(orgStatuses),
        owned: promiseResultToObject(orgOwners),
        available: undefined,
      },
      teams: {
        member: null, // promiseResultToObject(myTeams),
        maintainer: null, // promiseResultToObject(myTeamMaintainers),
      },
      teamCounts: {
        member: 0,
        maintainer: 0,
      },
      repos: {
        byTeam: null, // promiseResultToObject(repoTeams),
        byCollaboration: null, // too expensive to load; promiseResultToObject(repos),
      },
      errors: undefined,
    };

    results.teamCounts.maintainer = results.teams.maintainer && Array.isArray(results.teams.maintainer) ? results.teams.maintainer.length : 0;
    results.teamCounts.member = results.teams.member && Array.isArray(results.teams.member) ? results.teams.member.length : 0;

    // Available organizations
    if (results.organizations.member) {
      results.organizations.available = _.difference(organizationNames, results.organizations.member);
    }

    // Sort organization lists
    insensitiveCaseArrayReplacement(results.organizations, 'available');
    insensitiveCaseArrayReplacement(results.organizations, 'member');
    insensitiveCaseArrayReplacement(results.organizations, 'owned');

    if (errors) {
      results.errors = errors;
    }
    return results;
  }

  async getRepoCollaborators(): Promise<any> {
    const operations = this._operations;
    const options = {};
    const repos = await operations.graphManager.getReposWithCollaborators(options);
    return repos;
  }

  async getRepoTeams(): Promise<any> {
    const operations = this._operations;
    const options = {};
    const repos = await operations.graphManager.getUserReposByTeamMemberships(this.id, options);
    return repos;
  }

  async getTeamMemberships(optionalRole?): Promise<any> {
    const operations = this._operations;
    const options = { };
    if (optionalRole) {
      options['role'] = optionalRole;
    }
    options['maxAgeSeconds'] = 60 * 20;
    options['backgroundRefresh'] = true;
    const teams = await operations.graphManager.getUserTeams(this.id, options);
    return teams;
  }

  async getOrganizationNames(): Promise<string[]> {
    return this._operations.getOrganizationOriginalNames();
  }

  async getOrganizationStatuses(optionalRole?): Promise<any> {
    const operations = this._operations;
    const options = { };
    // options['role'] is not typed, need to validate down the call chain to be clean
    if (optionalRole) {
      options['role'] = optionalRole;
    }
    const member = await operations.graphManager.getMember(this.id, options);
    const value = member && member.orgs ? member.orgs : [];
    return value;
  }

  // ------------------------------ End views ---------------------------------

}

function insensitiveCaseArrayReplacement(parent, key) {
  if (parent && parent[key]) {
    const input = parent[key];
    delete parent[key];
    parent[key] = _.orderBy(input, entry => entry.toLowerCase());
  }
}

function promisesToErrors(...args: ISettledValue<any>[]) {
  const errors = [];
  for (const promise of arguments) {
    if (promise && promise.state !== SettledState.Fulfilled) {
      errors.push(promise.reason.message || promise.reason);
    }
  }
  return errors.length > 0 ? errors : undefined;
}

function promiseResultToObject<T>(promiseResult: ISettledValue<T>): T {
  if (promiseResult && promiseResult.state && promiseResult.state === SettledState.Fulfilled) {
    return promiseResult.value;
  }
}
