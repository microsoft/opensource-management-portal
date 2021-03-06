[Docs index](index.md)

# Changes

## 2020

- August 2020: Postgres added `corporatemail` as a new property; for performance reasons, looking up mail addresses, which are relatively static, has been a performance issue. This field is not required: a mail address lookup fallback will likely be in place for a while.

- The newer `events` entity type was refactored to use proper Postgres columns in April 2020. As this was not being used by any others, there is no entity migration script at this time that mapped the prior JSONP values into top-level column names.

## 2017

- Issue-based approval workflow (backed by GitHub issues) removed for all approvals
