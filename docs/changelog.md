[Docs index](index.md)

# Changes

## 2020

- The newer `events` entity type was refactored to use proper Postgres columns in April 2020. As this was not being used by any others, there is no entity migration script at this time that mapped the prior JSONP values into top-level column names.

## 2017

- Issue-based approval workflow (backed by GitHub issues) removed for all approvals
