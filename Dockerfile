FROM node:10-alpine AS build

ARG NPM_TOKEN

# Make Git available for NPM and rsync in the build image
RUN apk add --update git && rm -rf /var/cache/apk/*

WORKDIR /build
COPY . .

# Only if needed, copy .npmrc files into the container
# COPY Dockerfile.npmrc /build/.npmrc
# COPY .npmrc /build/.npmrc

RUN npm install --production --verbose && mv node_modules production_node_modules

# Dev dependencies
RUN npm install --verbose && rm -rf .npmrc

# TypeScript build
RUN npm run-script build

RUN cd default-assets-package && npm install && npm run build

FROM node:10-alpine AS run

ENV IS_DOCKER=1 \
    DEBUG=oss-initialize \
    NPM_CONFIG_LOGLEVEL=warn \
    PORT=3000

EXPOSE ${PORT}

WORKDIR /usr/src/repos

RUN addgroup oss && adduser -D -G oss oss && chown -R oss:oss .

# Production Node.js modules
COPY --from=build --chown=oss:oss /build/production_node_modules ./node_modules

# Assets that people not using painless config may need
COPY --from=build --chown=oss:oss /build/data ./data

# Copy built assets, app, config map
COPY --from=build --chown=oss:oss /build/dist ./
COPY --from=build --chown=oss:oss /build/default-assets-package ../default-assets-package
COPY --from=build --chown=oss:oss /build/config ./config
COPY --from=build --chown=oss:oss /build/views ./views
COPY --from=build --chown=oss:oss /build/package.json ./package.json
COPY --from=build --chown=oss:oss /build/jobs/reports/exemptRepositories.json \
    /build/jobs/reports/organizationDefinitions.json \
    /build/jobs/reports/repositoryDefinitions.json \
    /build/jobs/reports/teamDefinitions.json \
    ./jobs/reports/
COPY --from=build --chown=oss:oss /build/jobs/reports/views ./jobs/reports/views

# COPY package.json ./
# COPY views ./views
# COPY dist ./
# COPY public ./public

USER oss

CMD ["npm", "run-script", "start-in-container"]
