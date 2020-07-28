[Docs index](index.md)

# Data, databases, etc.

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
