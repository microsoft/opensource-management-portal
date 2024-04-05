#
# Copyright (c) Microsoft.
# Licensed under the MIT license. See LICENSE file in the project root for full license information.
#

ARG IMAGE_NAME=mcr.microsoft.com/cbl-mariner/base/nodejs:18

FROM $IMAGE_NAME AS build

ARG NPM_TOKEN

RUN tdnf -y update --quiet

# We used to also make Git available for NPM and rsync in build
#   tdnf clean all --quiet && \
#   tdnf -y install ca-certificates git --quiet && \

WORKDIR /build

COPY . .

# Only if needed, copy file with NPM_TOKEN arg
# COPY .npmrc.arg /build/.npmrc

RUN npm install --ignore-scripts --production --verbose
RUN npm ci
RUN npm run-script build
RUN mv node_modules production_node_modules
RUN rm -f .npmrc

# The open source project build needs: build the site assets sub-project
RUN cd default-assets-package && npm ci && npm run build

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
COPY --from=build /build/default-assets-package ./default-assets-package

COPY --from=build /build/config ./config
COPY --from=build /build/views ./views
COPY --from=build /build/package.json ./package.json

# Only if needed, copy our environment
# COPY --from=build /build/.environment ./.environment

# Only if needed, binary resources
# COPY --from=build /build/microsoft/assets ./microsoft/assets

ENTRYPOINT ["npm", "run-script", "start-in-container"]
