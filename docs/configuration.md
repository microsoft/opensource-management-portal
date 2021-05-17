[Docs index](index.md)

## Configuration

The configuration story for this application has been evolving over time. At this time, the
following configuration elements are available at this time, each with a distinct purpose.

Primary configuration is provided by `.env` files or process/container environment variables and volume files.

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
principal to `get` the secret value, use a custom `keyvault://` URI format.

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
