#
# Copyright (c) Microsoft.
# Licensed under the MIT license. See LICENSE file in the project root for full license information.


ARG IMAGE_NAME=mcr.microsoft.com/cbl-mariner/base/nodejs:16

FROM $IMAGE_NAME AS build

ARG NPM_TOKEN

# Make Git available for NPM and rsync in the build image
RUN tdnf -y update && \
    tdnf -y install ca-certificates git && \
    tdnf clean all

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

# Production Node.js modules
COPY --from=build /build/production_node_modules ./node_modules

# People not using painless config may need
COPY --from=build /build/data ./data

# Copy built assets, app, config map
COPY --from=build /build/dist ./

# The open source project build needs: default assets should be placed
COPY --from=build --chown=oss:oss /build/default-assets-package ./default-assets-package

COPY --from=build --chown=oss:oss /build/config ./config
COPY --from=build --chown=oss:oss /build/views ./views
COPY --from=build --chown=oss:oss /build/package.json ./package.json

# Host the app
USER oss

# Only if needed, copy environment
# COPY --from=build /build/.environment ./.environment

ENTRYPOINT ["npm", "run-script", "start-in-container"]
