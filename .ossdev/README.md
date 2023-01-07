# Open source development instance

There is a dev instance that deploys to Azure to manage some test organizations. The
"ossdev" world does not have any Microsoft-specific goo in it, to validate the true
open source project state.

At build time, the `package.json` file is patched to point to the `.ossdev/environment` folder
for loading environment variables and configuration, including pointing to key vault
secret names to load from.

An alternate to modifying the `package.json` is to set the `ENVIRONMENT_MODULES`
environment variable, or in `.env`, to `.ossdev/environment`.
