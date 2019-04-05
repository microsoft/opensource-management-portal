# opensource-portal

> Microsoft's GitHub-at-scale management portal

This Node.js application is a part of the suite of services provided by
the Open Source Programs Office at Microsoft to enable large-scale GitHub
management experiences.

Key features center around opinionated takes on at-scale management, with an emphasis on _relentless automation_ and _delegation_:

- __Linking__: the concept of associating a GitHub identity with an authenticated identity in another provider, for example an Azure Active Directory user
- __Self-service GitHub organization join__: one-click GitHub organization joining for authorized users
- __Cross-organization functionality__: consolidated views across a set of managed GitHub organizations including people, repos, teams

Before providing GitHub management functionality to all of Microsoft, this
application started within Azure.

> An introduction to this project is available in this 2015 post by Jeff Wilcox:   [http://www.jeff.wilcox.name/2015/11/azure-on-github/](http://www.jeff.wilcox.name/2015/11/azure-on-github/)

The app is a GitHub OAuth application; with the May 2017 release of
GitHub Apps (formerly called Integrations), this app over time may be
refactored to support the integration concept, removing the need to
dedicate a user seat to a machine account.

## Node app

- Node.js LTS (v10+)
- TypeScript
- Mixed callback and Q promises and async and whoa at this time

## Service Dependencies

- At least one of your own GitHub organizations
- Bring your own Redis server, or use Azure Redis Cache
- Azure Active Directory, or hack your own Passport provider in
- Data storage for links, etc.: either Azure Storage _or_ Postgres

## LICENSE

[MIT License](LICENSE)

## Dev prep, build, deploy

### Prereqs

#### Install Node packages

Make sure to include dev dependencies

```
$ npm install
```

### Build

```
$ npm run-script build
```

### Building the Docker image

You need to set the NPM_TOKEN parameter to the NPM token to the private registry.

```
$ docker build --build-arg NPM_TOKEN="YOURTOKENHERE" .
```

### Test

This project is starting to get improved testability. But it will be a long slog.

```
$ npm test
```

Which is equivalent to running:

```
$ mocha
```

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

## E-mail

A custom mail provider is being used internally, but a more generic mail
provider contract exists in the library folder for the app now. This
replaces or optionally augments the ability of the app to do workflow
over mail. Since Microsoft is an e-mail company and all.

# API

Please see the [API.md](API.md) file for information about the early API implementation.

# Undocumented / special features

This is meant to start an index of interesting features for operations
use.

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

## Breaking changes with the TypeScript version

- In-memory session and link providers enable an easier local development experience. As a result, you *must* configure a link provider type and a session type in settings.
  - SESSION_PROVIDER should be explicitly set to `redis`

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

```

```

In this mode memory providers are used, including a mocked Redis client. Note
that this does mean that a large GitHub organization configured with memory
providers could become a token use nightmare, as each new execution of the app
without a Redis Cache behind the scenes is going to have 100% cache misses for
GitHub metadata. Consider configuring a development or local Redis server to
keep cached data around.