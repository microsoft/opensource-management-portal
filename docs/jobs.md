# Jobs

There are automated cronjobs available to help keep things running smoothly,
if you choose to use them.

Jobs are an alternate entrypoint into the application, and have full use of
the same set of [providers](./providers.md).

## Webhook event firehose

> The primary consistency and event processing loop for the entire app. [firehose](../jobs/firehose.ts)

Ongoing processing of GitHub events for keeping cache up-to-date, locking down new repos, etc.

## Cleanup organization invitations

> [cleanupInvites](../jobs/cleanupInvites.ts)

If configured for an org, cleanup old unaccepted invites. This predates
GitHub-native expiration of invites.

## System Team permissions

> [permissions](../jobs/permissions.ts)

Updating permissions for all-write/all-read/all-admin teams when configured

## Refresh usernames and other link attributes

> [refreshUsernames](../jobs/refreshUsernames.ts)

Keeps link data fresh with GitHub username renames, corporate username and display name updates,
and removing links for deleted GitHub users who remove their accounts permanently from GitHub.com.

## Cleanup blob cache

Removes expired cache entities from the blob cache.

> [cleanupBlobCache](../jobs/cleanupBlobCache.ts)
