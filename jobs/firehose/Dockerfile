FROM node:6-alpine

ENV JOBNAME=firehose
ENV APPDIR="/usr/src/job${JOBNAME}"

ENV IS_DOCKER=1
ENV DEBUG=oss-initialize

# Make Git available for NPM
RUN apk add --update git && \
  rm -rf /tmp/* /var/cache/apk/*

COPY package.json /tmp/package.json
COPY node_modules.private/ /tmp/node_modules/
RUN cd /tmp && npm install --production
RUN mkdir -p "${APPDIR}" && cp -a /tmp/node_modules "${APPDIR}"

WORKDIR "${APPDIR}"

COPY package.json "${APPDIR}"
COPY . .

ENTRYPOINT node ./jobs/${JOBNAME}/
