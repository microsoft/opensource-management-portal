# opensource-portal

> Microsoft's GitHub-at-scale management portal

This Node.js application is a part of the suite of services provided by
the Open Source Programs Office at Microsoft to enable large-scale GitHub
management experiences.

Key features center around opinionated takes on at-scale management, with an emphasis on _relentless automation_ and _delegation_:

- __Linking__: the concept of associating a GitHub identity with an authenticated identity in another provider, for example an Azure Active Directory user
- __Self-service GitHub organization join__: one-click GitHub organization joining for authorized users
- __Cross-organization functionality__: consolidated views across a set of managed GitHub organizations including people, repos, teams

> An introduction to this project is available in this 2015 post by Jeff Wilcox:   [http://www.jeff.wilcox.name/2015/11/azure-on-github/](http://www.jeff.wilcox.name/2015/11/azure-on-github/)

Starting in 2020, the application pivoted to help scale better:

- The portal works best as a GitHub App instead of the older GitHub OAuth app model
- The app can be installed as multiple parallel apps (user-facing, operations, background jobs, and data) to ensure that key user experiences continue to function even if a background job or other task exhausts available REST API reosurces
- When combined with a near-realtime webhook feed, the app tracks updates for views in a database instead of through REST API caches.

## Node app

- Node.js LTS (v10+)
- TypeScript

Native promises and await/async are being introduced into the codebase. Older callback-based
code using libraries such as `async` or the promise library `q` have been removed.

## Service Dependencies

- At least one of your own GitHub organizations
- Bring your own cache system (built-in providers for Redis, Cosmos DB, and Azure storage)
- Azure Active Directory, or hack your own Passport provider in
- Data storage for links, etc.: either Azure Storage _or_ Postgres

## Dev prep, build, deploy

### Prereqs

#### Install Node packages

Make sure to include dev dependencies.

```
npm install
cd default-assets-package
npm install
```

### Build

```
npm run build
```

You need to rebuild the default-assets-package if you change something. [see Static Site Assets](#static-site-assets)

### Building the Docker image

```
$ docker build .
```

#### Run

The most easy way to run is by using the docker-compose setup. This will bootup the postgres and redis components as well. The docker-compose setup depends on 2 environment files and 1 json file:

- .docker.env
- .secrets.env
- env-orgs.json

Make sure to copy the .secrets.env.example and env-orgs.json.example files and provide the configuration values.

```bash
cp .secrets.env.example .secrets.env
cp env-orgs.json.example env-orgs.json
# provide configuration values for .secrets.env and env-orgs.json
docker-compose up
```

If you desire to run all on your local machine (redis, postgres) you might want to use following approach.

```bash
# ensure redis and postgres is running on localhost
source .secrets.env
source .local.env
npm run start
```

#### Troubleshooting

If the docker image doesn't start you can debug the image using an interactive shell session. This allows
you to browse the folders, update the files to test things and run the portal.

```bash
$ docker run --rm -it --env-file .secrets.env --env-file .docker.env --entrypoint /bin/sh opensource-portal
/usr/src/repos $ ls
app.js                   data                     lib                      package.json             tsconfig.tsbuildinfo     webhooks
app.js.map               entities                 localEnvironment.js      routes                   user
bin                      features                 localEnvironment.js.map  test                     utils.js
business                 github                   middleware               transitional.js          utils.js.map
config                   jobs                     node_modules             transitional.js.map      views
/usr/src/repos $ npm run start-in-container
```

### Test

This project basically has _no tests_.

# Work to be done

- Continuing to refactor out Microsoft-specific things when possible
- Tests
- Proper model/view/API system
- Front-end UI


# Implementation Details

Please see the `docs/` sub-folder, including [docs/index.md](docs/index.md).

## Configuration

Please see [docs/configuration.md](docs/configuration.md)

## Jobs

Please see [docs/jobs.md](docs/jobs.md)

# API

Please see the [docs/api.md](docs/api.md) file for information about the current API.

### Bare minimum local development environment

If you place a JSON file `env.json` above the directory of your cloned repo
(to prevent committing secrets to your repo by accident or in your editor),
you can configure the following extreme minimum working set to use the app.

The central operations token is a personal access token that is a **org owner**
of the GitHub org(s) being managed.

```
  "DEBUG_ALLOW_HTTP": "1",
  "GITHUB_CENTRAL_OPERATIONS_TOKEN": "a github token for the app",
  "GITHUB_ORGANIZATIONS_FILE": "../../env-orgs.json",
  "GITHUB_CLIENT_ID" : "your client id",
  "GITHUB_CLIENT_SECRET" : "your client secret",
  "GITHUB_CALLBACK_URL" : "http://localhost:3000/auth/github/callback",
  "AAD_CLIENT_ID": "your corporate app id",
  "AAD_REDIRECT_URL" : "http://localhost:3000/auth/azure/callback",
  "AAD_CLIENT_SECRET" : "a secret for the corporate app",
  "AAD_TENANT_ID" : "your tenant id",
  "AAD_ISSUER": "https://sts.windows.net/your tenant id/",
```

In this mode memory providers are used, including a mocked Redis client. Note
that this does mean that a large GitHub organization configured with memory
providers could become a token use nightmare, as each new execution of the app
without a Redis Cache behind the scenes is going to have 100% cache misses for
GitHub metadata. Consider configuring a development or local Redis server to
keep cached data around.

## LICENSE

[MIT License](LICENSE)

## Contributions welcome

Happy to have contributions, though please consider reviewing the CONTRIBUTING.MD file, the code of conduct,
and then also open a work item to help discuss the features or functionality ahead of kicking off any such
work.

This project has adopted the [Microsoft Open Source Code of
Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct
FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com)
with any additional questions or comments.