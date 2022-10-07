# Providers

This project has evolved over several years, and during a major refactoring
to begin using ECMAScript properly, + `await`, `async`, and TypeScript, it
has grown.

The `providers` was started during the "transition" to more modern practices by
providing a central place to ideally hang _interfaces_ to _useful services_ that
can be made available throughout the app to easily drop in new capabilities and
connect to services.

Ideally, a provider uses an _interface_, even if there is only a single implementation,
to try and encourage some separation, enable testing, and plugging in other tech.

It is an implementation detail whether to "require" a provider be present, or thrown or
ignore if it is null; feature flags or configuration can help.

The original providers cover very basic things:

- `app`: the Express app instance
- `basedir`: the base directory for the app
- `config`: the configuration graph for the app. This is currently untyped.
- `github`: the smart cache layer on top of Octokit
- `linkProvider`: create, delete, update links between third-party users and corporate users
- `operations`: the **main brain of the app** allowing for strongly-typed trusted corporate GitHub operations
- `viewServices`: a few helpers for Pug templates to use such as `moment`

Sources of truth:

- `repositoryMetadataProvider`: stores corporate metadata about who creates/configures a repo
- `organizationSettingsProvider`: stores configuration for GitHub organizations (if not using static config)
- `userSettingsProvider`: stores user settings _nearly completely unused, storing user state is bad_
- `tokenProvider`: personal access token _optional for API consumers_

Supporting providers:

- `insights`: Application Insights mock for basic events and metrics, or just console output if not configured
- `keyEncryptionKeyResolver`: supports retrieval and generation of encryption keys, only needed if using the legacy encrypted sessions or data stores (candidate for future removal)
- `mailProvider`: supports sending an e-mail
- `mailAddressProvider`: resolves e-mail addresses from corporate identities

Hosting, cache and database environment providers:

- `healthCheck`: Kubernetes health check signals
- `postgresPool`: provides access to a Postgres pool (this probably should not be so central and accessible to avoid coupling)
- `sessionRedisClient`: Redis client for use in sessions, if using Redis for session state
- `cacheProvider`: an abstracted cacher - can use Redis or Cosmos DB and/or Azure storage
- `redis`: **deprecated** a Redis helper connected to the main Redis instance
- `redisClient`: **deprecated** a primary Redis client instance
- `session`: access to session store

Fast indexes of key entities and memberships on GitHub:

- `queryCache`: the main query cache provider
- `organizationMemberCacheProvider`: entities: members of orgs
- `repositoryCacheProvider`: entities: cache of repos
- `repositoryCollaboratorCacheProvider`: entities: cache of repository collaborators _this is key to performance over the GitHub API_
- `teamCacheProvider`: entities: cache of teams
- `teamMemberCacheProvider`: entities: cache of team members
- `repositoryTeamCacheProvider`: entities: cache of repo team permissions

Providers built on top of entity metadata provider:

- `approvalProvider`: team join request approvals
- `auditLogRecordProvider`: store org webhook events as a simple audit log record
- `eventRecordProvider`: contribution data on public GitHub (this provider needs a rename)

Related to processing near real-time (NRT) streams from Webhook events:

- `webhookQueueProcessor`: pulls messages from a queue

Other capabilities have included:

- `campaign`: a poorly-named provider to enable event records for campaigns, redirecting to entities (_likely no longer in use_)
- `campaignStateProvider`: state related to mail campaigns and notices to allow for tracking sending at-most-once, plus opt-out capabilities
- `graphProvider`: essentially the Microsoft Graph: given a person, who is their manager? Their management chain?

Special providers that help this remain an open source project while building Microsoft-specific
use cases:

- `applicationProfile`: allows for hosting a separate set of routes replacing the main app
- `corporateAdministrationProfile`: adds new sections and routes to the administration UI
- `corporateViews`: a set of additional views that can be included in Pug templates
- `corporateContactProvider`: a Microsoft-specific provider to retrieve information such as the open source attorney a given employee has, their business reviewer for open source, etc.

Special providers for gold plated features:

- `localExtensionKeyProvider`: generates special keys for use in local encryption for link data
- `electionProvider`: supports FOSS Fund elections
- `electionVoteProvider`: supports FOSS Fund elections
- `electionNominationProvider`: supports FOSS Fund elections
- `electionNominationCommentProvider`: supports FOSS Fund elections
