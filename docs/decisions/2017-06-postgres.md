# Decision: Postgres

A decision was made in June 2017 to move away from the data stores used
by the Azure open source portal and to evolve to something more appropriate
for the scale and size of the app.

Previously, Azure table storage was used, alongside Azure Document DB (Cosmos DB).

Common operations performed on the data are recognized to be:

- All the links (expensive without pre-computing and storing in Cosmos; even pre-computed, more data than a Cosmos request)
- Basic querying and paging of data

Mitigations and changes:

- Abstracting data storage slightly using an "entity metadata provider" or separate concrete implementations for the link provider

An Azure-hosted Postgres offering being available made this an easy choice.

Decision by: Microsoft OSPO
Decisionmakers: Microsoft OSPO
