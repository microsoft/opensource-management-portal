# Changelog

Since this is an application more than a library, we haven't kept the changelog very up-to-date. Sorry.

## Major changes or breaking changes

### 7.2.0: Redis

Moved to Redis v4 with 7.2.0 of the site. Specific changes of note:

- Redis mock default instance for local cache testing in lieu of any configured providers has been removed.
- Redis prefix value, if set, is not used for web session storage
