FROM node:6-alpine

ENV APPDIR=/usr/src/repos

EXPOSE 3000

ENV IS_DOCKER=1
ENV DEBUG=oss-initialize

ENV NPM_CONFIG_LOGLEVEL=warn

# Make Git available for NPM
RUN apk add --update git && \
  rm -rf /tmp/* /var/cache/apk/*

COPY package.json /tmp/package.json
COPY node_modules.private/ /tmp/node_modules/
RUN cd /tmp && npm install --production
RUN mkdir -p "${APPDIR}" && cp -a /tmp/node_modules "${APPDIR}"

WORKDIR /usr/src/repos

COPY package.json "${APPDIR}"
COPY . .

ENTRYPOINT ["npm", "start"]
