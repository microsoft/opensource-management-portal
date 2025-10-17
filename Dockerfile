#
# Copyright (c) Microsoft.
# Licensed under the MIT license. See LICENSE file in the project root for full license information.
#

ARG IMAGE_NAME=mcr.microsoft.com/azurelinux/base/nodejs:20

FROM $IMAGE_NAME AS build

RUN tdnf -y update --quiet

WORKDIR /build

COPY . .
RUN rm -rf dist frontend/build

### Backend

# RUN npm install --ignore-scripts --production --verbose
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
RUN npm run-script build
RUN mv node_modules production_node_modules
RUN rm -f .npmrc

### Legacy static server-rendered site assets

# The open source project build needs: build the site assets sub-project
RUN cd default-assets-package && npm ci && npm run build

### Frontend

WORKDIR /build/frontend

RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
RUN npm run build
RUN rm -f .npmrc

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

# Copy frontend app
COPY --from=build /build/frontend/build ./frontend/build
COPY --from=build /build/frontend/package.json ./frontend/package.json

# The open source project build needs: default assets should be placed
COPY --from=build /build/default-assets-package ./default-assets-package

COPY --from=build /build/config ./config
COPY --from=build /build/views ./views
COPY --from=build /build/package.json ./package.json

# Only if needed, copy our environment
# COPY --from=build /build/.environment ./.environment

# Only if needed, binary resources
# COPY --from=build /build/microsoft/assets ./microsoft/assets

# Only if needed, binary resources
# COPY --from=build /build/microsoft/jobs/assets ./microsoft/jobs/assets

# Only if needed, sidecar resources
# COPY --from=build /build/microsoft/sites/mise-sidecar/configs ./microsoft/sites/mise-sidecar/configs


ENTRYPOINT ["npm", "run-script", "start-in-container"]
