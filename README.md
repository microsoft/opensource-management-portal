# opensource-portal

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

- Node.js LTS (v6.10+ as of 5/31/17)
- ES6
- Mixed callback and Q promises at this time

## Service Dependencies

- At least one of your own GitHub organizations
- Bring your own Redis server, or use Azure Redis Cache
- Azure Active Directory, or hack your own Passport provider in
- Azure Storage for table, `data.js` will need some refactoring to support other providers. _Other providers are being considered, including Azure Premium Table, for better performance. Help would be appreciated here!_

## LICENSE

[MIT License](LICENSE)

## Dev prep, build, deploy

### Prereqs

#### Install Node packages

Make sure to include dev dependencies

```
$ npm install
```

#### Suggested global NPM packages

```
$ npm install -g eslint bower mocha grunt-cli ember-cli
```

### Build

```
$ npm run-script build
```

Which is equivalent to running:

```
$ bower install
$ cd client
$ npm install
$ bower install
$ cd ..
$ grunt
```

### Test

This project is starting to get improved testability. But it will be a long slog.

```
$ npm test
```

Which is equivalent to running:

```
$ mocha
$ eslint .
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
