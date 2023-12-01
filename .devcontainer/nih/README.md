# NIH Devcontainer

## Steps for running from GitHub Codespaces

1. [Set Environment Secrets](#secrets)
1. Launch your Codespace using [these settings](https://github.com/codespaces/new?hide_repo_select=true&ref=GH-170-devcontainer&repo=348553095&skip_quickstart=true&machine=standardLinux32gb&devcontainer_path=.devcontainer%2Fnih%2Fdevcontainer.json&geo=UsEast).
1. Run the "Launch site 3000"configuration from the `Run and Debug` panel in VS Code.

### Secrets

Use Codespace secrets to inject sensitive configuration variables into GitHub Codespaces. This can either be done [manually](https://github.com/settings/codespaces), or with the [gh-codespace-secret.sh](gh-codespace-secret.sh) shell script which automatically loads/updates portal-specific variables that are set in the current environment. Note: before running `gh-codespace-secret.sh` you will need to have a `GITHUB_TOKEN` environment variable set with a PAT that has the `codespace:secrets` scope.

If you create the secrets manually, be sure to make the secrets visible to the repsoitory from which you are launching the codespace (eg github.com/NIHGov/github-portal).
