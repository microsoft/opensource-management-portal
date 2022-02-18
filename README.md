# opensource-management-portal

> Microsoft's Open Source Management Portal

This Node.js application is a part of the suite of services provided by
the Open Source Programs Office at Microsoft to enable large-scale GitHub
management experiences.

Key features center around opinionated takes on at-scale management, with an emphasis on _relentless automation_ and _delegation_:

- __Linking__: the concept of associating a GitHub identity with an authenticated identity in another provider, for example an Azure Active Directory user
- __Self-service GitHub organization join__: one-click GitHub organization joining for authorized users
- __Cross-organization functionality__: consolidated + transparent views across a set of managed GitHub organizations including people, repos, teams

> An introduction to this project is available in this 2015 post by Jeff Wilcox:   [http://www.jeff.wilcox.name/2015/11/azure-on-github/](http://www.jeff.wilcox.name/2015/11/azure-on-github/)

Improvements made a few years back include:

- The portal works best as a GitHub App instead of the older GitHub OAuth app model
- The app can be installed as multiple parallel apps (user-facing, operations, background jobs, and data) to ensure that key user experiences continue to function even if a background job or other task exhausts available REST API reosurces
- When combined with a near-realtime webhook feed, the app tracks updates for views in a database instead of through REST API caches.

While the default application experience is a server-rendered old-school site,
at Microsoft a modern React front-end sits on top of this backend that just serves
REST API requests.

We'd love to eventually open source the React front-end; while there are some cool
React server-side-and-frontend frameworks like Next.js, we have chosen not to take
such a dependency. It feels overly complicated to have the React client in this
open repository right now, and would likely be a sidecar project (separate repo)
when we do get that ready.

## Node app

- Node.js LTS (v16+)
- TypeScript

Native promises and await/async are being introduced into the codebase. Older callback-based
code using libraries such as `async` or the promise library `q` have been removed.

## Service Dependencies

- At least one of your own GitHub organizations
- Bring your own cache system (built-in providers for Redis, Cosmos DB, and Azure storage)
- Azure Active Directory, or hack your own Passport provider in (and help us extend the concept to be more generic and useful for Google auth, Okta, etc.)
- Data storage for links, etc.: either Azure Storage _or_ Postgres

## Firehose + query cache webhook processing

While the original portal works fine for very small GitHub presences, it
was designed around the idea that the cache would fill, while respecting the
GitHub REST API by using [Conditional Requests](https://docs.github.com/en/rest/overview/resources-in-the-rest-api#conditional-requests), and being very
eventually consistent.

However, the REST API v3 (non-GraphQL client) maximum size for a page of results
is 100 entries, which ... is very painful if you have tens of thousands of anything.

The "firehose" is designed to be run either within the app itself, or as a secondary
app processing results. At Microsoft, we use a service bus to process webhook events
from GitHub, since we have a robust webhook ingestion mechanism elsewhere. The 
firehose runs as a daemon that pulls off the queue and works to keep the "query cache" primed with newer information than the REST API may have in some cases.

What this improves:

- The user views of the orgs, repos, teams they are added to and have access to
- Cross-organization views and querying

The firehose and query cache are _not_ used for important or auth-style scenarios:

- Query cache is not used to make permission decisions
- Query cache is not used to authorize access to administrative functions

We did at one point design the idea of having a `/webhook` endpoint and validating
the webhook signatures before processing hooks for simple app hosting, but it's
slightly broken right now.

## Dev prep, build, deploy

### Prereqs

#### Install Node packages

Make sure to include dev dependencies.

The default assets package is a _super ancient_ Bootstrap and jQuery app that
in theory provides basic skin for the site, favicons, graphics, etc. However,
it's ... really, really, really old. Microsoft discards the default-assets-package,
using a different set of assets, so you've been mildly warned.

The `main` module of the defined default-assets-package should resolve to the
path to serve content from. Since the default version uses Grunt to build the
assets, it returns the `__dirname` + `/public`, which is the output/built location for Grunt.

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

This project basically has _very few tests_, and aspirations to start using Jest better.

# Work to be done

- Support more interesting cloud and data providers
- Support other authentication technologies
- More tests
- Ship the front-end UI to the world as open source
- Continuing to refactor out Microsoft-specific things when possible

# Implementation Details

Please see the `docs/` sub-folder, including [docs/index.md](docs/index.md).

## Configuration

Please see [docs/configuration.md](docs/configuration.md)

## Jobs

Please see [docs/jobs.md](docs/jobs.md)

# API

Please see the [docs/api.md](docs/api.md) file for information about the current API.

### Bare minimum local development environment

If you place a JSON file `.env` above the directory of your cloned repo
(to prevent committing secrets to your repo by accident or in your editor),
you can configure the following extreme minimum working set to use the app.

The central operations token is a personal access token that is a **org owner**
of the GitHub org(s) being managed.

```
DEBUG_ALLOW_HTTP=1
GITHUB_CENTRAL_OPERATIONS_TOKEN=a github token for the app
GITHUB_ORGANIZATIONS_FILE=../../env-orgs.json
GITHUB_CLIENT_ID=your client id
GITHUB_CLIENT_SECRET=your client secret
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
AAD_CLIENT_ID=your corporate app id
AAD_REDIRECT_URL=http://localhost:3000/auth/azure/callback
AAD_CLIENT_SECRET=a secret for the corporate app
AAD_TENANT_ID=your tenant id
AAD_ISSUER=https://sts.windows.net/your tenant id/
```

In this mode memory providers are used, including a mocked Redis client. Note
that this does mean that a large GitHub organization configured with memory
providers could become a token use nightmare, as each new execution of the app
without a Redis Cache behind the scenes is going to have 100% cache misses for
GitHub metadata. Consider configuring a development or local Redis server to
keep cached data around.

> The built-in Redis mock will likely be removed when we move to the next
> major semver of the Node Redis library.

## LICENSE

[MIT License](LICENSE)

## Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft 
trademarks or logos is subject to and must follow 
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
