# organization sudo

Organization-level sudo allows users that are not technically organization owners on
GitHub to perform administrative actions that the portal provides, such as managing repos,
or taking action on behalf of some users.

When using repository-level just-in-time (JIT), sudo also allows org sudo users to
JIT to help manage repositories.

## Feature flag: FEATURE_FLAG_ALLOW_ORG_SUDO

> This feature is **ON** by default

Historically, this project enabled organization sudoers by default. The configuration
default for the feature flag `allowOrganizationSudo` from environment `FEATURE_FLAG_ALLOW_ORG_SUDO`
reflects this default.

## Configuration options

The default provider uses GitHub Teams for authorization: a specific GitHub team ID is
configured for an organization. Membership in that GitHub Team for the user at the time
of the request is used to grant org-level sudo permission.

For those wanting to use security groups, a security group provider available. This
decouples the operations from the GitHub user and instead is based off of the privileges
of the linked user's corporate ID.

An abstract base class is available but not required to conform to the interface.

## Company-specific support

Overrides are available to allow the company-specific system to provide the
org sudo instance for an organization, if you wish to implement a different
approach, or use a different company-internal system for these decisions.

## portal sudo

Portal sudo applies sudo for all organizations configured within the application.
Used by system administrators typically.

The original design was to use the sudo configuration from the first/primary GitHub org
that was configured in the environment.

## Feature flag: FEATURE_FLAG_ALLOW_PORTAL_SUDO

> This feature is not on by default.

To opt into the feature, set the value to `1`.

## Configuration: providerName

Can be:

- `primaryorg` (default): use the sudo configuration from the primary/first-configured org
- `none` or '': no portal-wide sudo
- `securitygroup`: use a security group to determine if a linked user is a portal administrator

For the security group provider, configuration should set `SUDO_PORTAL_SECURITY_GROUP_ID` to the
security group ID to use.

## Debug flags: portal sudo

Two environment variables designed for development work exist:

- `DEBUG_GITHUB_PORTAL_SUDO_OFF`: set to `1` to turn off portal sudo
- `DEBUG_GITHUB_PORTAL_SUDO_FORCE`: set to `1` to turn portal sudo on for ALL users
