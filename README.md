# Azure GitHub Management: azure-oss-portal

The Azure Open Source Portal for GitHub is the culmination of years of trying to manage the
Azure presence on GitHub through a lot of trial, error, and improvement in tooling.

Starting as a hackathon, today it is used to manage a number of organizations on GitHub at
an enterprise-grade scale by automating organization onboarding and delegating management
decisions to team maintainers.

> A ton of information is available right now in this post in lieu of other README content  [http://www.jeff.wilcox.name/2015/11/azure-on-github/](http://www.jeff.wilcox.name/2015/11/azure-on-github/)

# Platform

- Node.js LTS+

# Service Dependencies

- Bring your own Redis server, or use Azure Redis Cache
- Azure Active Directory, or hack your own Passport provider in
- Azure Storage for table, `data.js` will need some refactoring to support other providers

Oh, and you'll need your own GitHub org.

# LICENSE

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

# Implementation Details

## Configuration

_We have avoided using a rich configuration framework in the name of agility and recognizing
the diversity of many deployment environments._

The configuration story for this application has been evolving over time. At this time, the
following configuration elements are available at this time, each with a distinct purpose.

- Environment Variables (see `configuration.js` for details)
- JSON Files (either committed directly to a repo or overwritten during deployment)
  - `resources.json`: categories, links and special resources to light up learning resources
  - `organizations.json`: organization configuration information, an alternate and additive way to include organization config in the app at deployment time. For this method to work, make sure to set the configuration environment to use from such a file using the `CONFIGURATION_ENVIRONMENT` env variable.
- [Azure Key Vault](https://azure.microsoft.com/en-us/services/key-vault/) secrets

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

At this time the secrets are only read during application initialization, so a
rotation of a secret would require restarting, redeploying, or otherwise kicking
the service to grab the rotated secret.

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
