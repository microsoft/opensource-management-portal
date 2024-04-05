# Service dependencies

_This content was moved from the `README.md` to reduce clutter. More content would be helpful._

- GitHub organization(s)
- Hosting environment
- Background job environment for eventual consistency work and maintenance cronjobs
- Daemon hosting for near-real-time process
- Queue system
- A cache system or multi-tiered cache implementation
- Azure Active Directory and the Microsoft Graph
- An email service to send mail
- Optional insights or telemetry system

## Source of truth store

The backend maintains in a data store of your choice key metadata for
repositories, links, and general compliance info. The backend supports
natively Azure Storage, Azure Table, Azure CosmosDB, and Postgres.

We use **Postgres** for source of truth including:

- GitHub organization configuration
- corporate GitHub repository metadata
- corporate identity-to-GitHub login links
- compliance metadata (enable/disabled repos)
