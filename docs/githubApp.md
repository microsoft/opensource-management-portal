# How the app authenticates with GitHub

**Modern GitHub App is strongly recommended!**

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
