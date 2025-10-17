//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from './repository.js';
import { getPageSize, getMaxAgeSeconds, CacheDefault, Operations } from './index.js';
import { AppPurpose } from '../lib/github/appPurposes.js';
import {
  PurposefulGetAuthorizationHeader,
  ICacheOptions,
  GetAuthorizationHeader,
  GitHubAccountWithType,
} from '../interfaces/index.js';
import { GitHubAppPermission, GitHubPermissionDefinition } from '../lib/github/types.js';

type GitHubAdvisorySeverity = 'low' | 'medium' | 'high' | 'critical' | null;

type GitHubAdvisoryState = 'published' | 'closed' | 'withdrawn' | 'draft' | 'triage';

type GitHubAdvisoryIdentifier = {
  type: 'GHSA' | 'CVE';
  value: string;
};

type GitHubVulnerablePackage = {
  ecosystem:
    | 'rubygems'
    | 'npm'
    | 'pip'
    | 'maven'
    | 'nuget'
    | 'composer'
    | 'go'
    | 'rust'
    | 'erlang'
    | 'actions'
    | 'pub'
    | 'other'
    | 'swift';
  name: string;
};

type CvssScore = {
  vector_string: string;
  score: number;
};

type CweScore = {
  cwe_id: string;
  name: string;
};

type GitHubAdvisoryCreditType =
  | 'analyst'
  | 'finder'
  | 'reporter'
  | 'coordinator'
  | 'remediation_developer'
  | 'remediation_reviewer'
  | 'remediation_verifier'
  | 'tool'
  | 'sponsor'
  | 'other';

type GitHubAdvisoryCreditState = 'accepted' | 'declined' | 'pending';

type GitHubAdvisoryCredit = {
  login: string;
  type: GitHubAdvisoryCreditType;
};

type GitHubAdvisoryDetailedCredit = {
  user: GitHubAccountWithType;
  type: GitHubAdvisoryCreditType;
  state: GitHubAdvisoryCreditState;
};

type GitHubAdvisoryVulnerability = {
  package: GitHubVulnerablePackage;
  vulnerable_version_range: string;
  patched_versions: string; // GitHub claims this is a string or null, not an array of strings
  vulnerable_versions: string[];
};

export type GitHubRepositoryAdvisory = {
  ghsa_id: string;
  cve_id: string;
  url: string;
  html_url: string;
  summary: string;
  description: string;
  severity: GitHubAdvisorySeverity;
  author: GitHubAccountWithType;
  publisher: GitHubAccountWithType;
  identifiers: GitHubAdvisoryIdentifier[];
  state: GitHubAdvisoryState;
  created_at: string; // iso8601
  updated_at: string; // iso8601
  published_at?: string; // iso8601
  closed_at?: string; // iso8601
  withdrawn_at?: string; // iso8601
  submission?: {
    accepted: boolean;
  };
  vulnerabilities: GitHubAdvisoryVulnerability[];
  cvss?: CvssScore;
  cvss_severities?: {
    cvss_v3: CvssScore;
    cvss_v4: CvssScore;
  };
  cwes?: CweScore[];
  cwe_ids?: string[];
  credits?: GitHubAdvisoryCredit[];
  credits_detailed?: GitHubAdvisoryDetailedCredit[];
  collaborating_users?: GitHubAccountWithType[];
  private_fork?: unknown;
};

const PERMISSIONS_READ_PRIVATE_ADVISORIES: GitHubPermissionDefinition = {
  permission: 'repository_advisories',
  access: GitHubAppPermission.Read,
};

type ReportingEnabledResponse = {
  enabled: boolean;
};

export class RepositoryAdvisories {
  private _getAuthorizationHeader: PurposefulGetAuthorizationHeader;
  private _operations: Operations;
  private _repository: Repository;

  constructor(
    repository: Repository,
    getAuthorizationHeader: PurposefulGetAuthorizationHeader,
    getSpecificAuthorizationHeader: PurposefulGetAuthorizationHeader,
    operations: Operations
  ) {
    this._repository = repository;
    this._getAuthorizationHeader = getAuthorizationHeader;
    this._operations = operations;
  }

  async isReportingEnabled(): Promise<boolean> {
    const operations = this._operations as Operations;
    const { rest } = operations.github.octokit;
    const github = operations.github;
    const requirements = operations.github.createRequirementsForFunction(
      this.authorize(AppPurpose.Data),
      rest.repos.getRepoRulesets,
      'repos.checkPrivateVulnerabilityReporting'
    );
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
    };
    try {
      const outcome: ReportingEnabledResponse = await github.callWithRequirements(requirements, parameters);
      return outcome?.enabled || false;
    } catch (err) {
      // NOTE: GitHub documents that this endpoint is only for public unarchived repositories,
      // so a 404 may be possible in scenarios other than deleted repos.
      // A 422 is sent for archived.
      throw err;
    }
  }

  async listAdvisories(cacheOptions?: ICacheOptions): Promise<GitHubRepositoryAdvisory[]> {
    cacheOptions = cacheOptions || {};
    const operations = this._operations as Operations;
    const parameters = {
      owner: this._repository.organization.name,
      repo: this._repository.name,
      per_page: getPageSize(operations),
    };
    if (!cacheOptions.maxAgeSeconds) {
      cacheOptions.maxAgeSeconds = getMaxAgeSeconds(
        operations as Operations,
        CacheDefault.repoBranchesStaleSeconds /* not specific */
      );
    }
    if (cacheOptions.backgroundRefresh === undefined) {
      cacheOptions.backgroundRefresh = true;
    }
    const { github } = operations;
    const { rest } = github.octokit;
    const listResponse = (await github.callWithRequirements(
      github.createRequirementsForFunction(
        this.authorize(AppPurpose.Security),
        rest.securityAdvisories.listRepositoryAdvisories,
        'securityAdvisories.listRepositoryAdvisories',
        {
          permissions: PERMISSIONS_READ_PRIVATE_ADVISORIES,
        }
      ),
      parameters
    )) as GitHubRepositoryAdvisory[];
    return listResponse;
  }

  private authorize(purpose: AppPurpose): GetAuthorizationHeader | string {
    const getAuthorizationHeader = this._getAuthorizationHeader.bind(this, purpose) as GetAuthorizationHeader;
    return getAuthorizationHeader;
  }
}
