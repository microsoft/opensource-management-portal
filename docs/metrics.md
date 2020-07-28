[Docs index](index.md)

# Metrics

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
