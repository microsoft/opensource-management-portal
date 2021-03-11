ARG IMAGE_NAME=node:15-alpine

FROM $IMAGE_NAME AS build

ARG NPM_TOKEN

# Make Git available for NPM and rsync in the build image
RUN apk add --update git && rm -rf /var/cache/apk/*

WORKDIR /build
COPY package.json .
COPY package-lock.json .

# Only if needed, copy .npmrc files into the container
# COPY Dockerfile.npmrc /build/.npmrc

# If you are doing local development and OK with your private tokens in the contains (CAREFUL):
# DO NOT RECOMMEND:
# COPY .npmrc /build/.npmrc

# RUN npm install --production --verbose && mv node_modules production_node_modules
RUN npm install --production && mv node_modules production_node_modules

COPY . .

# Only if needed, copy .npmrc files into the container, again...
# COPY Dockerfile.npmrc /build/.npmrc

# Dev dependencies
# RUN npm install --verbose && rm -rf .npmrc
RUN npm install && rm -rf .npmrc

# TypeScript build
RUN npm run-script build

# The open source project build needs: build the site assets sub-project
RUN cd default-assets-package && npm install && npm run build

FROM $IMAGE_NAME AS run

ENV IS_DOCKER=1 \
    NPM_CONFIG_LOGLEVEL=warn \
    DEBUG=startup \
    PORT=3000

EXPOSE 3000

WORKDIR /usr/src/repos

RUN addgroup oss && adduser -D -G oss oss && chown -R oss:oss .

# Production Node.js modules
COPY --from=build --chown=oss:oss /build/production_node_modules ./node_modules

# People not using painless config may need
COPY --from=build --chown=oss:oss /build/data ./data

# Copy built assets, app, config map
COPY --from=build --chown=oss:oss /build/dist ./

# The open source project build needs: default assets should be placed
COPY --from=build --chown=oss:oss /build/default-assets-package ../default-assets-package

COPY --from=build --chown=oss:oss /build/config ./config
COPY --from=build --chown=oss:oss /build/views ./views
COPY --from=build --chown=oss:oss /build/package.json ./package.json
COPY --from=build --chown=oss:oss /build/jobs/reports/views ./jobs/reports/views

# Reports are not actively working in the project, but keeping these files ready
COPY --from=build --chown=oss:oss /build/jobs/reports/exemptRepositories.json \
     /build/jobs/reports/organizationDefinitions.json \
     /build/jobs/reports/repositoryDefinitions.json \
     /build/jobs/reports/teamDefinitions.json \
     ./jobs/reports/

# Host the app
USER oss
ENTRYPOINT ["npm", "run-script", "start-in-container"]
