#!/bin/bash
set -e
WRITE=0
REPOSITORIES=${REPOS:-"nihgov/github-portal"}

if [[ -z "$GITHUB_TOKEN" ]]; then
    printf "GITHUB_TOKEN with scope 'codespace:secrets' must be set to create secrets." 1>&2
    exit 1
fi

# Fail safe requiring explicit permission to write secrets with the --write flag
if [[ $1 == "--write" ]]; then
    WRITE=1
else
    printf "Running in dry-run mode. Pass --write flag to create secrets.\n\n"
fi

# Filter to remove variables that have default values in the devcontainer.json
# to reduce unneeded secrets from being created.
FILTER="KEY_FILE\|REPOS_*\|^DEBUG|SESSION_COOKIE_DOMAIN"

# Get list of application environment variables from the devcontainer.json file
ENV_VARS=($(cat devcontainer.json | sed 's/^ *\/\/.*//' | jq -r ".remoteEnv | keys[]" | grep -v $FILTER))

FLAG="--no-store"

# Remove no store flag if not in dry-run
if [ "$WRITE" -eq "1" ]; then
  FLAG=""
fi

# Loop through each variable and create a secret if the variable is set
for VAR in "${ENV_VARS[@]}"
do
    # Check if the variable is set
    if [[ -n "${!VAR}" ]]; then

      # Replace GITHUB_ with GH_ since GitHub secrets cannot start with GITHUB
      CLEANED_VAR="${VAR/GITHUB_/GH_}"

      # If in dry-run mode print the encrypted, base64-encoded value instead of
      # storing it on Github with the --no-store flag
      if [ "$WRITE" -eq "0" ]; then
        printf "\033[0;32m$CLEANED_VAR: \033[0m"
      fi

      # Create the secret or print the encrpyted secret
      gh secret set -a codespaces $FLAG -u $CLEANED_VAR -b"${!VAR}" -r $REPOSITORIES
    fi
done
