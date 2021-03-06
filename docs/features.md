[Docs index](index.md)

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
  - Requirements: the event firehose must be used (there is no equivalent job, to make sure to not accidentially destroy permissions across existing repos)

- allowUnauthorizedForkLockdownSystem

  - Variable: `FEATURE_FLAG_ALLOW_UNAUTHORIZED_FORK_LOCKDOWN_SYSTEM`
  - Purpose: Locks repositories that are forks until they are approved by an administrator
  - Requirements: depends on the new repo lockdown system already being enabled and in use

## Temporary features

An optional set of features are being developed for use in summer 2020 as part
of the industry movement to prefer new branch names for repos.

These temporary features can be configured using the following variables:

- `GITHUB_NEW_REPOS_RENAME_DEFAULT_BRANCH`: set to `1` to rename the default branch for repos created through the site or wizard
- `GITHUB_NEW_REPOS_RENAME_DEFAULT_BRANCH_EXCLUDE_API`: set to `1` to exclude repos created by API
- `GITHUB_NEW_REPOS_DEFAULT_BRANCH_NAME`: set to the name of the default branch to snap do, defaulting to `main`
