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

FROM node:10-alpine AS run

ENV APPDIR=/usr/src/repos \
    IS_DOCKER=1 \
    DEBUG=oss-initialize \
    NPM_CONFIG_LOGLEVEL=warn \
    PORT=3000

EXPOSE ${PORT}

# Production Node.js modules
COPY --from=build /build/production_node_modules "${APPDIR}/node_modules"

# Assets that people not using painless config may need
COPY --from=build /build/data "${APPDIR}/data"

# Copy built assets, app, config map
COPY --from=build /build/dist "${APPDIR}"
COPY --from=build /build/config "${APPDIR}/config"
COPY --from=build /build/views "${APPDIR}/views"
COPY --from=build /build/package.json "${APPDIR}/package.json"
COPY --from=build /build/jobs/reports/exemptRepositories.json "${APPDIR}/jobs/reports/"
COPY --from=build /build/jobs/reports/organizationDefinitions.json "${APPDIR}/jobs/reports/"
COPY --from=build /build/jobs/reports/repositoryDefinitions.json "${APPDIR}/jobs/reports/"
COPY --from=build /build/jobs/reports/teamDefinitions.json "${APPDIR}/jobs/reports/"
COPY --from=build /build/jobs/reports/views "${APPDIR}/jobs/reports/views"

WORKDIR /usr/src/repos

# COPY package.json "${APPDIR}"
# COPY views "${APPDIR}/views"
# COPY dist "${APPDIR}"
# COPY public "${APPDIR}/public"

RUN addgroup oss && adduser -D -G oss oss \
 && chown -R oss:oss .
USER oss

CMD ["npm", "run-script", "start-in-container"]
