# Feature flags

Under development, configuration values in `config/features.json` map
explicit opt-in environment variables to features and functions for
the monolithic site.

This was, organizations can choose which specific features they may
want to have exposed by the app.

Most features can be opted in to by setting the environment
variable value to `1`.

- allowUnauthorizedNewRepositoryLockdownSystem
  - Variable: `FEATURE_FLAG_ALLOW_UNAUTHORIZED_NEW_REPOSITORY_LOCKDOWN_SYSTEM`
  - Purpose: Allows the "unauthorized new repository lockdown system" to be _available_ as an organization feature flag. It does not turn this system on by default in any case.
  - Requirements: the event firehose must be used (there is no equivalent job, to make sure to not accidentally destroy permissions across existing repos)

- allowUnauthorizedForkLockdownSystem
  - Variable: `FEATURE_FLAG_ALLOW_UNAUTHORIZED_FORK_LOCKDOWN_SYSTEM`
  - Purpose: Locks repositories that are forks until they are approved by an administrator
  - Requirements: depends on the new repo lockdown system already being enabled and in use

- allowApiClient
  - Variable: `FEATURE_FLAG_ALLOW_API_CLIENT`
  - Purpose: Allows session-based client APIs, used for powering a modern front-end app connected to the site
  - Default (2024): _true/on_ with the OSS of the React frontend

- exposeWebhookIngestionEndpoint
  - Variable: `EXPOSE_WEBHOOK_INGESTION_ENDPOINT`
  - Value: set to `1` to enable the `/api/webhook`/ endpoint that ingests GitHub webhook event bodies.
  - Default: `0`
  - Risk/notes: when exposing this endpoint, webhook signature validation should also be performed. At this time, the webhook signature verification code is incomplete.
  - Recommendation: use a more secure route, such as the queue-based firehose processing method.

## Temporary features

An optional set of features are being developed for use in summer 2020 as part
of the industry movement to prefer new branch names for repos.

These temporary features can be configured using the following variables:

- `GITHUB_NEW_REPOS_RENAME_DEFAULT_BRANCH`: set to `1` to rename the default branch for repos created through the site or wizard
- `GITHUB_NEW_REPOS_RENAME_DEFAULT_BRANCH_EXCLUDE_API`: set to `1` to exclude repos created by API
- `GITHUB_NEW_REPOS_DEFAULT_BRANCH_NAME`: set to the name of the default branch to snap do, defaulting to `main`
