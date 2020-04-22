# opensource-portal

> Microsoft's GitHub-at-scale management portal

This Node.js application is a part of the suite of services provided by
the Open Source Programs Office at Microsoft to enable large-scale GitHub
management experiences.

Key features center around opinionated takes on at-scale management, with an emphasis on _relentless automation_ and _delegation_:

- __Linking__: the concept of associating a GitHub identity with an authenticated identity in another provider, for example an Azure Active Directory user
- __Self-service GitHub organization join__: one-click GitHub organization joining for authorized users
- __Cross-organization functionality__: consolidated views across a set of managed GitHub organizations including people, repos, teams

> An introduction to this project is available in this 2015 post by Jeff Wilcox:   [http://www.jeff.wilcox.name/2015/11/azure-on-github/](http://www.jeff.wilcox.name/2015/11/azure-on-github/)

Starting in 2020, the application pivoted to help scale better:

- The portal works best as a GitHub App instead of the older GitHub OAuth app model
- The app can be installed as multiple parallel apps (user-facing, operations, background jobs, and data) to ensure that key user experiences continue to function even if a background job or other task exhausts available REST API reosurces
- When combined with a near-realtime webhook feed, the app tracks updates for views in a database instead of through REST API caches.

## Node app

- Node.js LTS (v10+)
- TypeScript

Native promises and await/async are being introduced into the codebase. Older callback-based
code using libraries such as `async` or the promise library `q` have been removed.

## Service Dependencies

- At least one of your own GitHub organizations
- Bring your own cache system (built-in providers for Redis, Cosmos DB, and Azure storage)
- Azure Active Directory, or hack your own Passport provider in
- Data storage for links, etc.: either Azure Storage _or_ Postgres

## Dev prep, build, deploy

### Prereqs

#### Install Node packages

Make sure to include dev dependencies.

```
npm install
cd default-assets-package
npm install
```

### Build

```
npm run build
``` 

You need to rebuild the default-assets-package if you change something. [see Static Site Assets](#static-site-assets)  

### Building the Docker image

```
$ docker build .
```

### Test

This project basically has _no tests_.

# Work to be done

- Continuing to refactor out Microsoft-specific things when possible
- Tests
- Proper model/view/API system
- Front-end UI


# Implementation Details

## Configuration

The configuration story for this application has been evolving over time. At this time, the
following configuration elements are available at this time, each with a distinct purpose.

A GitHub organization(s) configuration file in JSON format is required as of version 4.2.0 of the app.

- Environment Variables (see `configuration.js` for details)
- JSON Files (either committed directly to a repo or overwritten during deployment)
  - `config/resources.json`: categories, links and special resources to light up learning resources
  - `config/organizations.json`: organization configuration information, an alternate and additive way to include organization config in the app at deployment time. For this method to work, make sure to set the configuration environment to use from such a file using the `CONFIGURATION_ENVIRONMENT` env variable.
- [Azure Key Vault](https://azure.microsoft.com/en-us/services/key-vault/) secrets

With the current configuration story, a `CONFIGURATION_ENVIRONMENT` variable is required, as well
as a secret for AAD to get KeyVault bootstrapped. That requirement will go away soon.

### Configuring organizations

When installed as a GitHub App, the installations can be added into the "dynamic settings" system where
the org info is stored in an entity database. This allows the app and jobs to pick up the latest configuration
without needing redeployment.

Alternatively, a static JSON file can be provided to store configuration details and other information
about your GitHub orgs that the app will manage.

#### Static orgs

The opensource-portal only shows GitHub-organizations which are configured in a specific file. The path for this file is handed over with the environment-variable `GITHUB_ORGANIZATIONS_FILE`, which specifies the relative path of this file from the `data`-folder as root directory. This JSON-file has to be created, here is an example of the organizations-file:

```
[
  {
    "name": "ContosoDev",
    "id": 20195765,
    "type": "public",
    "ownerToken": "keyvault://portalppe.vault.azure.net/secrets/dev-github-org-contosodev-repos-token",
    "description": "Contoso Public Development - Cloud",
    "teamAllMembers": "2063735",
    "teamPortalSudoers": "2063734",
    "preventLargeTeamPermissions": true,
    "teamAllReposRead": "2280089",
    "teamAllReposWrite": "2148455",
    "templates": ["mit", "microsoft.docs", "dnfmit", "dnfmit.docs", "other"]
  },
  {
    "name": "contoso-d",
    "id": 9669768,
    "type": "public",
    "ownerToken": "keyvault://portalppe.vault.azure.net/secrets/local-github-org-contosodev-repos-token",
    "description": "Classic contoso-d",
    "teamAllMembers": "1944235",
    "preventLargeTeamPermissions": true,
    "teamAllReposRead": "2275189",
    "teamAllReposWrite": "2275190",
    "teamAllReposAdmin": "2279870",
    "templates": ["mit", "dnfmit"]
  }
]
```

Here is a short overview about the meanings of the different parameters:
- name (mandatory): GitHub organization name
- id (mandatory ([soon](https://github.com/microsoft/opensource-portal/issues/92))): organization id
- ownerToken (mandatory): personal access token of an organization owner
- type: supported repo types
- description: description text which is shown for the organization
- teamAllMembers: every member of this team is org-member (team-ID required)
- teamAllReposRead: every member of this team has read access to all repos (team-ID required)
- teamAllReposWrite: every member of this team has write access to all repos (team-ID required)
- teamAllReposAdmin: every member of this team has admin access to all repos (team-ID required)
- templates: GitHub repository templates
- locked: joining this organization via the opensource-portal is disabled

### PostgreSQL Configuration

To run the opensource-portal with a postgres database, you need to [setup postgres](https://www.postgresql.org/docs/11/runtime.html) and initialize the database by running the `pg.sql`-file in the psql-terminal.
It's recommended to [run postgres in a docker container](https://hub.docker.com/_/postgres), there is also an offical docker image called `postgres` for building.

Once the setup is done, set the `host`, `database`, `user`, `password`, `ssl` (as boolean) and `port` of the postgres in the `config/data.postgres.json`-file.
Additionally set the name of the linking-table (`tableName` parameter), if the tables were created with the `pg.sql`-file, the name for this table is `links`.

There is also a script in the `scripts` folder that can blast the `pg.sql` insertions into a new database. Be
sure to configure grants and your user accounts with the concept of least privilege required.

### Cache Configuration

For caching GitHub-requests with Redis, [setup a redis database](https://redis.io/topics/quickstart) ([running Redis in a docker container](https://hub.docker.com/_/redis/) is recommended, there is an official docker image called `redis` for building).

After Redis setup is complete, set your Redis configs in the `config/redis.json`-file. The `post` and `host` parameters are mandatory, other configs are optional (depending on the Redis configuration).

Other providers available include Azure Blob (slower but cheap), Cosmos DB, and a hybrid Cosmos+Blob.

### KeyVault Secret Support

Any configuration string property can be resolved to a KeyVault secret.

To use a stored KeyVault secret, configuration to allow this application's service
principal to `get` the secret value, simply use a custom `keyvault://` URI format.

For example, given a key vault named `samplevault`, setting a configuration
parameter to `keyvault://samplevault.vault.azure.net/secrets/secret-name/optionalVersion`
would resolve that secret.

To select a custom user `tag` for a secret, use the `auth` parameter of the
URI: a value of `keyvault://username@samplevault.vault.azure.net/secrets/secret-name` would
get the secret and its metadata, setting the configuration value to the `username` tag, if
present.

#### Key rotation

As configuration, including secrets, is resolved at startup, any key rotation would need
to include a restart of the app service.

## Minimum Configuration

If you place a JSON file `env.json` above the directory of your cloned repo
(to prevent committing secrets to your repo by accident or in your editor),
you can configure the following extreme minimum working set to use the app.

In this mode memory providers are used, including a mocked Redis client. Note
that this does mean that a large GitHub organization configured with memory
providers could become a token use nightmare, as each new execution of the app
without a Redis Cache behind the scenes is going to have 100% cache misses for
GitHub metadata. Consider configuring a development or local Redis server to
keep cached data around.

For authentication, the opensource-portal uses Azure Active Directory (AD) for corporate authentication 
and GitHub OAuth2 for the GitHub authentication.

### Azure Active Directory Configuration

Create an Azure Active Directory application ([guide](https://docs.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)) and set the IDs and the redirect-URL in the `config/activeDirectory.json` file.

### GitHub App Configuration (modern)

Create a new GitHub App.

Make sure the app has these permissions:

- Administration (R&W)
- Metadata (R)
- Org members (R&W)
- Org administration (R&W)
- Plan (R)
- Blocking users (R&W, recommended)

Subscribe to these events in only your single app instance _or_ your operations instance:

- meta
- fork
- member
- membership
- organization
- public
- repository
- star
- team
- team add
- org block

Download the private key for the app to be able to authenticate.

You can do this 3 more times to create dedicated apps for `UI`, `background jobs`, `data`, and `operations` in total.

### GitHub OAuth2 Configuration (legacy)

Create an GitHub OAuth2 application ([guide](https://developer.github.com/apps/building-oauth-apps/creating-an-oauth-app/)) and set the IDs and the callback-URL in the `config/github.oauth2.json` file.

You need to grant the application [third party permissions](https://help.github.com/en/articles/about-oauth-app-access-restrictions). To do this, navigate to the following link `https://github.com/orgs/<org-name>/policies/applications/<application-ID>`.

## Jobs

Several jobs are available in the container or the `jobs/` folder. These can
optionally provide useful operational and services support. Often a Kubernetes
CronJob can help.

- `cleanupInvites`: if configured for an org, cleanup old unaccepted invites
- `firehose`: ongoing processing of GitHub events for keeping cache up-to-date
- `managers`: cache the last-known manager for links, to use in notifications after a departure may remove someone from the graph
- `permissions`: updating permissions for all-write/all-read/all-admin teams when configured
- `refreshUsernames`: keeping link data fresh with GitHub username renames, corporate username and display name updates, and removing links for deleted GitHub users who remove their accounts permanently from GitHub.com
- `reports`: processing the building of report data about use, abandoned repos, etc. __this job is broken__

## Scripts

- `migrateLinks`: a one-time migration script to help when moving link source of truth

## Application Insights

When using Microsoft Application Insights, this library reports a number of metrics, events and
dependencies.

Library events include:

- UserUnlink: When a user object is unlinked and dropped

User interface events include:

- PortalUserUnlink: When a person initiates and completes an unlink
- PortalUserLink: When a person links their account
- PortalUserReconnectNeeded: When a user needs to reconnect their GitHub account
- PortalUserReconnected: When a user successfully reconnects their GitHub account when using AAD-first auth

## Email, corporate contacts and graph providers

A custom mail provider is being used internally, but a more generic mail
provider contract exists in the library folder for the app now. This
replaces or optionally augments the ability of the app to do workflow
over mail. Since Microsoft is an e-mail company and all.

# API

Please see the [API.md](API.md) file for information about the early API implementation.

## people

### /people search view

- Add a `type=former` query string parameter to show a current understanding of potential former employees who cannot be found in the directory
- In the `type=former` view, portal system sudoers will receive a link next to the user to 'manage user', showing more information and the option to remove from the org

## repos

### /repos search view

- Add a `showids=1` query string parameter to have repository IDs show up next to repository names

# new repo templates

When a new repository is created, a template directory can be used to
pre-populate that repo with any important files such as a standard LICENSE
file, README, contribution information, issue templates for GitHub, etc.

See also: `config/github.templates.js` which exports information from
a template data JSON file, as well as determines where those templates
live on the file system.

The original location for templates was within the same repo in the
`data/templates` folder; however, you can also use a public or private
NPM package that contains the template content.

# Static Site Assets

To simplify the app build process, and also make it easier for us to open
source a lot of the project without Microsoft-specific assets and content,
the site pulls its static assets (favicon, graphics, client scripts) from
an NPM package.

Inside the app's `package.json`, a property can be set, `static-site-assets-package-name`,
pointing to the name of an NPM package (public or private) that contains those assets.

By default, this project contains a `default-assets-package` sub-folder NPM package
with more generic Bootstrap content, Grunt build scripts, etc. It is used if this variable
is not defined in the package JSON. Unfortunately you need to separately
`npm install` and `grunt` to use it, or just point it at your own set of
CSS files and other assets. Sorry, its not pretty.

### Removed features and functions

- Issue-based approval workflow (backed by GitHub issues) removed for all approvals

### Data quality issues

_username casing_

The original table store for usernames (GitHub users, etc.) was case sensitive
for stored data. However, the newer Postgres system uses case insensitive
indexes. As a result there may be latent bugs.

_date/times_

- Approval 'decisionTime' field was buggy in the past
- Approval 'requested' field was buggy in the past

Going forward these fields are ISO8601 date time fields. Existing data may
continue to have poor formats, and may be an issue during data migration.

### Migration of data

The `localEnvironment` TypeScript file is intended to permit prototyping and
local development hacks.

A job, `migrateLinks`, is able to move links between providers when proper
configuration is in place.

### Bare minimum local development environment

If you place a JSON file `env.json` above the directory of your cloned repo
(to prevent committing secrets to your repo by accident or in your editor),
you can configure the following extreme minimum working set to use the app.

The central operations token is a personal access token that is a **org owner**
of the GitHub org(s) being managed.

```
  "DEBUG_ALLOW_HTTP": "1",
  "GITHUB_CENTRAL_OPERATIONS_TOKEN": "a github token for the app",
  "GITHUB_ORGANIZATIONS_FILE": "../../env-orgs.json",
  "GITHUB_CLIENT_ID" : "your client id",
  "GITHUB_CLIENT_SECRET" : "your client secret",
  "GITHUB_CALLBACK_URL" : "http://localhost:3000/auth/github/callback",
  "AAD_CLIENT_ID": "your corporate app id",
  "AAD_REDIRECT_URL" : "http://localhost:3000/auth/azure/callback",
  "AAD_CLIENT_SECRET" : "a secret for the corporate app",
  "AAD_TENANT_ID" : "your tenant id",
  "AAD_ISSUER": "https://sts.windows.net/your tenant id/",
```

In this mode memory providers are used, including a mocked Redis client. Note
that this does mean that a large GitHub organization configured with memory
providers could become a token use nightmare, as each new execution of the app
without a Redis Cache behind the scenes is going to have 100% cache misses for
GitHub metadata. Consider configuring a development or local Redis server to
keep cached data around.

# How the app authenticates with GitHub

The service as a monolith is able to partition keys and authentication for
GitHub resources at the organization level.

## GitHub org owner Personal Access Token

There is a 'central operations token' supported to make it easy for the
simple case. That central token is used if an org does not have a token
defined, or in resolving cross-org assets - namely **teams by ID** and
**accounts by ID**.

In lieu of a central ops token, the first configured organization's token
is used in the current design.

Individual orgs can have their own token(s) defined from their own
account(s).

## Traditional GitHub OAuth app

An OAuth app is used to authenticate the GitHub users. This app needs to
be approved as a third-party app in all your GitHub apps currently.

## Modern GitHub App

Work in progress: supporting modern GitHub apps. Will require configuring
the installation ID for a given organization.

For performance reasons, a partitioned/purpose-intended app model is
being designed that will fallback to the one configured app installation,
if any. If there is no modern GitHub app, the GitHub PAT for an org will
be used.

# Feature flags

Under development, configuration values in `config/features.json` map
explicit opt-in environment variables to features and functions for
the monolithic site.

This was, organizations can choose which specific features they may
want to have exposed by the app.

Most features can be opted in to by simply setting the environment
variable value to `1`.

- allowUnauthorizedNewRepositoryLockdownSystem

  - Variable: `FEATURE_FLAG_ALLOW_UNAUTHORIZED_NEW_REPOSITORY_LOCKDOWN_SYSTEM`
  - Purpose: Allows the "unauthorized new repository lockdown system" to be _available_ as an organization feature flag. It does not turn this system on by default in any case.
  - Requirements: the event firehose must be used (there is no equivalent job, to make sure to not accidentially destroy permissions across existing repos)

- allowUnauthorizedForkLockdownSystem

  - Variable: `FEATURE_FLAG_ALLOW_UNAUTHORIZED_FORK_LOCKDOWN_SYSTEM`
  - Purpose: Locks repositories that are forks until they are approved by an administrator
  - Requirements: depends on the new repo lockdown system already being enabled and in use

## Breaking changes

- The newer `events` entity type was refactored to use proper Postgres columns in April 2020. As this was not being used by any others, there is no entity migration script at this time that mapped the prior JSONP values into top-level column names.

## LICENSE

[MIT License](LICENSE)


## Contributions welcome

Happy to have contributions, though please consider reviewing the CONTRIBUTING.MD file, the code of conduct,
and then also open a work item to help discuss the features or functionality ahead of kicking off any such
work.

This project has adopted the [Microsoft Open Source Code of
Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct
FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com)
with any additional questions or comments.
