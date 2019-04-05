FROM node:10-alpine AS build

ARG NPM_TOKEN

# Make Git available for NPM and rsync in the build image
RUN apk add --update git rsync && \
  rm -rf /tmp/* /var/cache/apk/*

COPY . /tmp/
COPY Dockerfile.npmrc /tmp/.npmrc

RUN cd /tmp && npm install --production --verbose
RUN rsync -azhqi /tmp/node_modules/ /tmp/production_node_modules

# Dev dependencies
RUN cd /tmp && npm install --verbose
RUN rm -rf /tmp/.npmrc

# TypeScript build
RUN cd /tmp && node ./node_modules/typescript/bin/tsc

FROM node:10-alpine AS run
ENV APPDIR=/usr/src/repos

RUN mkdir -p "${APPDIR}"

# Production Node.js modules
COPY --from=build /tmp/production_node_modules "${APPDIR}/node_modules"

# Assets that people not using painless config may need
#COPY --from=build /tmp/data "${APPDIR}/data"

# Copy built assets, app, config map
COPY --from=build /tmp/dist "${APPDIR}"
COPY --from=build /tmp/config "${APPDIR}/config"
COPY --from=build /tmp/views "${APPDIR}/views"
COPY --from=build /tmp/package.json "${APPDIR}/package.json"
COPY --from=build /tmp/jobs/reports/exemptRepositories.json "${APPDIR}/jobs/reports/"
COPY --from=build /tmp/jobs/reports/organizationDefinitions.json "${APPDIR}/jobs/reports/"
COPY --from=build /tmp/jobs/reports/repositoryDefinitions.json "${APPDIR}/jobs/reports/"
COPY --from=build /tmp/jobs/reports/teamDefinitions.json "${APPDIR}/jobs/reports/"
COPY --from=build /tmp/jobs/reports/views "${APPDIR}/jobs/reports/views"

WORKDIR /usr/src/repos

# COPY package.json "${APPDIR}"
# COPY views "${APPDIR}/views"
# COPY dist "${APPDIR}"
# COPY public "${APPDIR}/public"

ENV IS_DOCKER=1
ENV DEBUG=oss-initialize

ENV NPM_CONFIG_LOGLEVEL=warn

ENV PORT 3000
EXPOSE 3000

RUN addgroup oss && adduser -D -G oss oss \
 && chown -R oss:oss "${APPDIR}"
USER oss

ENTRYPOINT ["npm", "run-script", "start-in-container"]
