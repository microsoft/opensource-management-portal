# Configuration

The configuration story for this application has been evolving over time. At this time, the
following configuration elements are available at this time, each with a distinct purpose.

Primary configuration is provided by `.env` files or process/container environment variables and volume files.

Configuration values are retrieved in this order:

- `.env` above root, _only if_ you also set `PREFER_DOTENV` to '1' in the `.env` or `process.env`
- process environment variable
- `.env` above root
- environment configuration defaults, values, key vault locations, volume files

A GitHub organization(s) configuration file in JSON format is required as of version 4.2.0 of the app.

- Environment Variables (see `configuration.js` for details)
- JSON Files (either committed directly to a repo or overwritten during deployment)
  - `config/resources.json`: categories, links and special resources to light up learning resources
  - `config/organizations.json`: organization configuration information, an alternate and additive way to include organization config in the app at deployment time. For this method to work, make sure to set the configuration environment to use from such a file using the `CONFIGURATION_ENVIRONMENT` env variable.
- [Azure Key Vault](https://azure.microsoft.com/en-us/services/key-vault/) secrets

With the current configuration story, a `CONFIGURATION_ENVIRONMENT` variable is optional, as well
as a secret for AAD to get KeyVault bootstrapped. The environment will default to your NODE_ENV
if not set (i.e. `development`).

The reason for `PREFER_DOTENV` is that in some cases, environments such as
GitHub Codespaces will set the process environment for editors to all the
secret values, which may not allow per-Codespace-instance overrides using
`.env`, but this is a dev-time only opt-in approach.

## Configuring organizations

When installed as a GitHub App, the installations can be added into the "dynamic settings" system where
the org info is stored in an entity database. This allows the app and jobs to pick up the latest configuration
without needing redeployment.

Alternatively, a static JSON file can be provided to store configuration details and other information
about your GitHub orgs that the app will manage.

> **Warning**:
> Application behavior and configuration schemas between dynamic and static settings are not identical. The dynamic settings system is the preferred method of configuration.

### Dynamic Settings

The opensource-portal can be configured to read organization configurations from a database which allows the application to retrieve the latest configuration without requiring a redeployment.

> **Note**:
> The application uses the `updated` field to determine if a configuration has changed. If the `updated` field is not present, the application will assume the configuration has not changed.

#### Example dynamic settings configuration

```json
{
  "organizationid": 20195765,
  "organizationname": "ContosoDev",
  "active": true,
  "features": ["locked", "createReposDirect"],
  "portaldescription": "This is a sample org",
  "specialteams": [],
  "legalentities": [],
  "setupdate": "2019-01-01T00:00:00.000Z",
  "setupbycorporateusername": "john.doe",
  "setupbycorporatedisplayname": "John Doe",
  "setupbycorporateid": "aa6d1298-1a6c-4646-a51b-2f74659f42fb",
  "type": ["public", "private"],
  "updated": "2019-01-01T00:00:00.000Z"
}
```

#### Dynamic settings schema

Here is a short overview about the meanings of the different parameters:

- **active** (boolean) - Used to flag inactive or unadopted organization
- **features** (string[]) - Features enabled for the organization.
- **legalentities** (string[]) - Legal entities associated with the organization
- **operationsnotes** (string) - Notes about the organization for operations purposes
- **organizationid** (integer, required) - GitHub ID of the organization
- **organizationname** (string, required) - GitHub organization name
- **portaldescription** (string) - User-facing description of the organization
- **properties** (string[]) - Legal entities associated with the organization
- **templates** (string[]) - Names of template repositories
- **type** (string|string[]) - supported GitHub repository visibility type(s) (eg: public, private)
- **setupbycorporateusername** (string) - Username (from the corporate identity system) of the user who set up the organization
- **setupbycorporateid** (string) - Unique identifier (from the corporate identity system) for the user who set up the organization
- **setupbycorporatedisplayname** (string) - Display name (from the corporate identity system) for the user who set up the organization
- **specialteams** (object{specialTeam: string, teamId: integer}) - Special team configuration for the organization supported values for `specialTeam` types are: `everyone, sudo, globalSudo, systemWrite, systemRead, systemAdmin, openAccess`. The `teamId` is the GitHub team ID for the special team.

### Static settings

The opensource-portal can also be configured to read organization configurations from a static file. When using this method, specify the path for the configuration file using the environment variable `GITHUB_ORGANIZATIONS_FILE`. When present, the application reads this as variable as relative path to the `data` folder in the root directory. Static settings files are expected to be in JSON format using this schema:

#### Static settings schema

- **name** (string, required) - GitHub organization name
- **id** (integer, required) - GitHub ID of the organization
- **locked** (boolean) - Disables joining this organization from the portal
- **ownerToken** (string) - personal access token of an organization owner
- **type** (string|string[]) - supported GitHub repository visibility type(s) (eg: public, private)
- **description** (string) - description text which is displayed in the portal for the organization
- **teamAllMembers** (string) - GitHub team ID of a team which includes all members of the organization
- **teamAllReposRead** (string) - GitHub team ID in which each member receives read access to all repos
- **teamAllReposWrite** (string) - GitHub team ID in which each member receives write access to all repos
- **teamAllReposAdmin** (string) - GitHub team ID in which each member receives admin access to all repos
- **templates** (string[]) - Names of template repositories

#### Example static settings configuration

```json
{
  "name": "ContosoDev",
  "id": 20195765,
  "type": "public",
  "ownerToken": "PERSONAL-ACCESS-TOKEN",
  "description": "Contoso Public Development - Cloud",
  "teamAllMembers": "2063735",
  "teamPortalSudoers": "2063734",
  "preventLargeTeamPermissions": true,
  "teamAllReposRead": "2280089",
  "teamAllReposWrite": "2148455",
  "templates": ["mit", "other"]
}
```

## PostgreSQL Configuration

To run the opensource-portal with a postgres database, you need to [setup postgres](https://www.postgresql.org/docs/11/runtime.html) and initialize the database by running the `data/pg.sql`-file in the psql-terminal.
It's recommended to [run postgres in a docker container](https://hub.docker.com/_/postgres), there is also an official docker image called `postgres` for building.

Once the setup is done, set the `host`, `database`, `user`, `password`, `ssl` (as boolean) and `port` of the postgres in the `config/data.postgres.json`-file.
Additionally set the name of the linking-table (`tableName` parameter), if the tables were created with the `data/pg.sql`-file, the name for this table is `links`.

There is also a script in the `scripts` folder that can blast the `data/pg.sql` insertions into a new database. Be
sure to configure grants and your user accounts with the concept of least privilege required.

## Cache Configuration

For caching GitHub-requests with Redis, [setup a redis database](https://redis.io/topics/quickstart) ([running Redis in a docker container](https://hub.docker.com/_/redis/) is recommended, there is an official docker image called `redis` for building).

After Redis setup is complete, set your Redis configs in the `config/redis.json`-file. The `post` and `host` parameters are mandatory, other configs are optional (depending on the Redis configuration).

Other providers available include Azure Blob (slower but cheap), Cosmos DB, and a hybrid Cosmos+Blob.

## KeyVault Secret Support

Any configuration string property can be resolved to a KeyVault secret.

To use a stored KeyVault secret, configuration to allow this application's service
principal to `get` the secret value, use a custom `keyvault://` URI format.

For example, given a key vault named `samplevault`, setting a configuration
parameter to `keyvault://samplevault.vault.azure.net/secrets/secret-name/optionalVersion`
would resolve that secret.

To select a custom user `tag` for a secret, use the `auth` parameter of the
URI: a value of `keyvault://username@samplevault.vault.azure.net/secrets/secret-name` would
get the secret and its metadata, setting the configuration value to the `username` tag, if
present.

### Key rotation

As configuration, including secrets, is resolved at startup, any key rotation would need
to include a restart of the app service.

## Minimum Configuration

If you place a `.env` file above the directory of your cloned repo
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

## Web hosting environment

Explore basic web hosting values that can be configured by environment variable in the
`config/webServer.json` file. This set of logic isn't very great right now.

Environment variables of note:

- `PORT`
- `DEBUG_ALLOW_HTTP`: if terminating HTTPS upstream, or performing local development against localhost, you may want to set this to `1`
- `SSLIFY_ENABLED`: set to 1 to enable the `express-sslify` middleware. [View express-sslify docs](https://github.com/florianheinemann/express-sslify#reverse-proxies-heroku-nodejitsu-and-others)
  - `SSLIFY_TRUST_PROTO_HEADER`: set to 1 for reverse proxies.
  - `SSLIFY_TRUST_AZURE_HEADER`: set to 1 for Azure deployments if looking for `x-arr-ssl`

For container development and deployments:

- `IS_DOCKER`: allow HTTP, HSTS off
- `IS_CONTAINER_DEPLOYMENT`: set `secure` on cookies, hsts on, `app.enable('trust proxy');`

### Which values we use for which scenarios

When we deploy a container on Azure App Service on Linux, we set `IS_CONTAINER_DEPLOYMENT`.

If we were deploying into a Windows App Service instance, we would set `SSLIFY_ENABLED` and `SSLIFY_TRUST_AZURE_HEADER`.

For local containerized development, we set `IS_DOCKER`.

When developing locally or in Codespaces, we set `DEBUG_ALLOW_HTTP`.

When using Codespaces, we set `CODESPACES_DESKTOP` if we are using Visual Studio Code and not the web-hosted experience.
