# Open Source Management Portal

This application represents the home for open source engineering experiences
at Microsoft. As a backend application it manages source of truth for many
types of corporate open source metadata, historical intent of repos
and projects, hosts a rich front-end, and also a set of APIs used by partner
teams.

While we prefer native GitHub experiences, when it comes to displaying certain info
and being more transparent about permissions and metadata, especially on
GitHub, which has no extensible user interface, we end up using and driving
people to this Open Source Management Portal to get the information they
need.

At Microsoft, 50,000 engineers are using a version of this portal as part of
their open source engineering experience. However, Microsoft does have a set
of "company-specific" extensions, including a separate React frontend client,
that are not currently part of this repository. And... yup, if we were to
start over today, we'd probably make this a Next.js-or-similar project.

Core capabilities and features of this application:

- **Linking GitHub accounts ⛓️** for enterprise use
- **Self-service GitHub organization joining 🙋** for engineers
- **Creating and managing GitHub open source repositories 👩‍💻**
- **Displaying transparent information, metrics, and company-specific data** about our GitHub open source presence around permissions, access, metadata, intent, and especially cross-organization views and search indexes
- **People inventory 👨‍🦳🧑‍🚀🧒🏽** to help people connect GitHub public logins with corporate identities
- **Intercepting forks and new repositories 🔐** to inject compliance and approval processes
- **Disable and enable 🔑** experiences for GitHub repositories
- **Just-in-time (JIT) access 🚪** for open source repositories, teams, and organizations, aligning with the principle of least privilege access
- **Sudo ⚡️** capabilities for repos, teams, organizations to remove persistent broad ownership and admin permissions
- **Hosting APIs 🍽️** to create repos, large-scale orgs to access link data, and reports
- **Background jobs 👷‍♂️** to maintain eventual consistency, run tasks, gather metrics, and prepare OKRs
- **Team join requests/approvals with context 🚪** building beyond the GitHub experience
- **Automated offboarding 🛶** when people take on new opportunities

At Microsoft, additional capabilities include:

- **Pre-release business and legal approvals to release projects 🧑‍⚖️**
- **Requesting contribution reviews ✍🏾** within policy
- **Service Tree and Direct Owners inventory 🌳** for showing accountable ownership information for repos when available
- **Hosting internal docs 📚** at aka.ms/opensource
- **Hosting a subset of opensource.microsoft.com's APIs 🌍** to bring to life the Microsoft open source presence

The management portal is designed to be fast, efficient, and get out of the way of engineers
to get their important work done, with an emphasis on _relentless automation_ and _delegation_.

Most of the experience is eventually consistent; however, operational actions
such as joining teams, orgs, sudo operations, etc., are fully consistent at the time
they are requested.

## Implementation Details and More Docs

Please see the `docs/` sub-folder, including [docs/index.md](docs/index.md).

## API

Please see the [docs/api.md](docs/api.md) file for information about the current API.

## Application stack for learning

As a TypeScript/Node.js backend application, with a React frontend, the
management portal also serves as a learning opportunity for Microsoft's
engineering systems teams to understand the experience that non-.NET stack
applications may have. The 1ES+OSPO teams partner to ship the application
based on essentially a fork of this open source repo.

As of 2022, the backend site is hosted by Azure App Service with
Linux containers, while the background cronjobs and daemons run in
Azure Kubernetes Service (AKS) clusters. All containers are built on top
of the CBL Mariner distro.

The app started as a hackathon project in an ancient JavaScript era full
of "callback hell", and has evolved through to third-party promise libraries
to native ECMAScript promises and to TypeScript. So it both shows its age,
and, is, interesting.

### Web app authentication

The **primary** authentication for the site is **Azure Active Directory** for
corporate users.

The **secondary** authentication is **GitHub**. This allows users not using
GitHub to fully explore the site, link, and otherwise be productive.

_In theory, open source friends, this project could be made a bit more
extensible. In the past, we prototyped Google authentication, as an example,
for the primary aspect. Contributions welcome!_

APIs can use either JWTs or an active web app session in some cases, used
by the React frontend.

### Configuration ⛳️

Many feature flags exist.

Please see [docs/configuration.md](docs/configuration.md)

### Jobs 💼

Please see [docs/jobs.md](docs/jobs.md)

## Service dependencies

- GitHub organization(s)
- Hosting environment
- Background job environment for eventual consistency work and maintenance cronjobs
- Daemon hosting for near-real-time process
- Queue system
- A cache system or multi-tiered cache implementation
- Azure Active Directory and the Microsoft Graph
- An email service to send mail
- Optional insights or telemetry system

### Source of truth store 🧑‍⚖️

The backend maintains in a data store of your choice key metadata for
repositories, links, and general compliance info. The backend supports
natively Azure Storage, Azure Table, Azure CosmosDB, and Postgres.

At Microsoft we currently use **Postgres** for source of truth including:

- GitHub organization configuration
- corporate GitHub repository metadata
- corporate identity-to-GitHub login links
- compliance metadata (enable/disabled repos)

### Respecting the GitHub API

To be friendly to GitHub, we strive to be very efficient and fair in
our use of the GitHub API. We cache as much as we can, and have a
native concept of building on top of GitHub's **Conditional Request**
best practice for GitHub Apps: whenever possible, we send the `e-tag` for
a request, and we will use our cache for many types of operations.

For long multi-page GitHub REST API v3 responses, we will maintain a
cache of those responses and rebuild them slowly in the background,
as the site is eventually consistent for most views.

For operational work, a real-time API call is used to continue to be
accurate and secure when working around granting access or managing
access to superuser features.

### Cache

The primary cache layer is backed by **CosmosDB** documents, in a hybrid
approach where larger documents fallback to **Azure Storage** (blob). Redis is
also supported for open source users of the site.

### Background event processing firehose and cronjobs

There are at least 2 ongoing single-instance daemonsets and many cronjobs
that also keep the site efficient, up-to-date, and gather important info.

The daemons:

- **Firehouse**: webhook event processing from a queue for eventual consistency and reacting to GitHub events around compliance/audit/scale/management
- **Just-in-time**: JIT revocations, audit log event gathering, and analysis

Example cronjobs:

- Make sure caches are primed occasionally
- Remind people to setup or delete repos
- Automatically delete repos that are not setup in a time window
- Disabling repos out of compliance
- Collecting data and metrics for reports and user interface experiences
- Backing up link data
- Prepare stats for an OKR

#### About the firehose in detail

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
slightly broken right now and disabled at Microsoft.

## Dev prep, build, deploy

### Install Node packages

Make sure to include dev dependencies.

The default assets package is a _super ancient_ Bootstrap and jQuery app that
in theory provides basic skin for the site, favicons, graphics, etc. However,
it's ... really, really, really old. Microsoft discards the default-assets-package,
using a different set of assets, so you've been mildly warned.

The `main` module of the defined default-assets-package should resolve to the
path to serve content from. Since the default version uses \[ancient\] Grunt to build the
assets, it returns the `__dirname` + `/public`, which is the output/built location for Grunt.

```bash
npm install
cd default-assets-package
npm install
```

### Build

```bash
npm run build
```

You need to rebuild the default-assets-package if you change something. [see Static Site Assets](docs/staticSiteAssets.md)

### Codespaces instructions

You will likely want to use a defined environment to save time spinning up many variables, follow one of the below paths:

- GitHub Codespaces account-level secrets for your environment variables as well
- use a `.env` file up a folder from the cloned repository in your Codespace environment
- configure environment variables once the devcontainer boots
- GitHub Codespaces repo-specific secrets

Whether as a secret or in the `../env` from the root, set

- `CONFIGURATION_ENVIRONMENT`: `development` (or similar)

Then, you'll also need to make sure authentication will work when redirecting to the running
Codespaces environment.

### GitHub authentication

You'll want to bring your own GitHub App and use its client ID and client secret for
authentication. [Configure your account-specific Codespace secrets](https://github.com/settings/codespaces).

- `CODESPACES_GITHUB_AUTHENTICATION_ENABLED`: set to `1` to enable
- `CODESPACES_GITHUB_CLIENT_ID`: the client ID
- `CODESPACES_GITHUB_CLIENT_SECRET`: the client secret

Configure the secrets for your fork and/or this repository as necessary. The redirect URL will
be dynamically generated and included in the startup debug output. Make sure that the hostname
is an appropriate callback URL for the GitHub app.

#### Enterprise Managed Users impersonation/override

Since the underlying repository and the Codespace are likely hosted in GHEC EMU,
you will also need to use the debug-time impersonation features to override the EMU
user information after a GitHub callback with your GitHub.com account.

For ease of use, an initial impersonation override feature is available that
only will override a GitHub EMU response:

- `CODESPACES_IMPERSONATE_OVERRIDE_EMU_ENABLED`: set to `1` to allow in your environment
- `CODESPACES_IMPERSONATE_OVERRIDE_EMU_LOGIN`: set to the login to use _only_ when an EMU user authenticates. _The primary impersonation feature will still be used after this._

### AAD authentication

Configure your AAD application in an appropriate tenant.

- `CODESPACES_AAD_AUTHENTICATION_ENABLED`: set to `1` to enable
- Set the other AAD variables for your environment as necessary:
  - `AAD_CLIENT_ID`
  - `AAD_CLIENT_SECRET`
  - ...

### Private artifacts

The Microsoft-internal fork of this project uses a private Azure Artifact feed
to bring in additional components and libraries. These are not applicable to
the open source upstream and should be excluded currently.

### Building the Docker image

```bash
docker build -t opensource-management-portal .
```

#### Run (OSS instructions)

> This section is from the open source community

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

This project basically has _very few tests_, and aspirations to start using Jest better. Oops. Bad debt as multiple hackathons combine, along with
production dependencies on GitHub...

### Bare minimum local development environment

If you place a JSON file `.env` above the directory of your cloned repo
(to prevent committing secrets to your repo by accident or in your editor),
you can configure the following extreme minimum working set to use the app.

The central operations token is a personal access token that is a **org owner**
of the GitHub org(s) being managed.

```env
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

## Collaboration

This project began as a hackathon... so still has growing pains years later.
Since this is technically a _backend web application_ and includes some
server-generated user interface, the project was not originally designed
to be shared as something that runs out-of-the-box, but... it is possible.

To collaborate on extensibility and improvements, please sync in the issues
first so we can come up with the best approach.

Again, since Microsoft strips most of the `routes/` and uses a React frontend
on this app, it's likely `routes/` and the Pug rendering is... old. Very old.

Hopefully this **monolith** can at least be an interesting learning
opportunity in crufty old ancient apps evolving on the JavaScript front!

### Work to be done (OSS project)

- Support more interesting cloud and data providers
- Support other authentication technologies
- Any tests
- More tests
- Ship the front-end UI to the world as open source
- Continuing to refactor out Microsoft-specific things when possible

## Project origin

An introduction to this project is available in a [2015 post by JWilcox](https://jeffwilcox.blog/2015/11/azure-on-github/) and a
[2019 follow-up post, "Scaling from 2,000 to 25,000"](https://jeffwilcox.blog/2019/06/scaling-25k/).

An Open Source Hub concept was prototyped by a Microsoft subsidiary and
the early Open Source Programs Office to make very clear the open source
experiences, docs, and guides for Microsoft's culture change to working
more in the open, releasing projects, and connecting everything together.

At the same time, GitHub was very basic, and it was necessary to automate and
make self-service the GitHub engineering system to work at an enterprise scale.
When Azure became the first approved organization to use GitHub at Microsoft,
this portal scaled access and built guardrails around the GitHub environment.

## LICENSE

[MIT License](LICENSE)

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit <https://cla.opensource.microsoft.com>.

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
