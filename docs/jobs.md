# Jobs

There are automated cronjobs available to help keep things running smoothly,
if you choose to use them.

Jobs are an alternate entrypoint into the application, and have full use of
the same set of [providers](./providers.md).

## list of cronjobs

Several jobs are available in the container or the `jobs/` folder. These can
optionally provide useful operational and services support. Often a Kubernetes
CronJob can help.

- `cleanupInvites`: if configured for an org, cleanup old unaccepted invites
- `firehose`: ongoing processing of GitHub events for keeping cache up-to-date
- `managers`: cache the last-known manager for links, to use in notifications after a departure may remove someone from the graph
- `permissions`: updating permissions for all-write/all-read/all-admin teams when configured
- `refreshUsernames`: keeping link data fresh with GitHub username renames, corporate username and display name updates, and removing links for deleted GitHub users who remove their accounts permanently from GitHub.com
- `reports`: processing the building of report data about use, abandoned repos, etc. **this job is broken**
