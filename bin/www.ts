#!/usr/bin/env node
//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import Debug from 'debug';

const debug = Debug.debug('g:server');
const debugInitialization = Debug.debug('startup');

import app from '../app';

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';

function normalizePort(val) {
  const port = parseInt(val, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}

const port = normalizePort(process.env.PORT || '3000');
app.set('port', port);

// debugInitialization('initializing app & configuration');

app.startServer = function startWebServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const server: https.Server | http.Server =
        process.env.USE_LOCAL_HTTPS === 'true'
          ? https.createServer(
              {
                key: fs.readFileSync(path.join(__dirname, process.env.CERT_PATH_FROM_DIST_BIN, 'key.pem')),
                cert: fs.readFileSync(path.join(__dirname, process.env.CERT_PATH_FROM_DIST_BIN, 'cert.pem')),
              },
              app
            )
          : http.createServer(app);

      server.on('error', (error) => {
        console.error(`http.server.error: ${error}`);
        if (error['syscall'] !== 'listen') {
          return reject(error);
        }
        const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;
        // handle specific listen errors with friendly messages
        switch (error['code']) {
          case 'EACCES':
            console.error(bind + ' requires elevated privileges');
            process.exit(1);
            break;
          case 'EADDRINUSE':
            console.error(bind + ' is already in use');
            process.exit(1);
            break;
          default:
            return reject(error);
            throw error;
        }
      });
      server.on('listening', () => {
        const addr = server.address();
        const bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr.port;
        debug('listening on ' + bind);
        return resolve();
      });
      server.listen(port);
    } catch (error) {
      return reject(error);
    }
  });
};

app.startupApplication().then(async function ready() {
  debugInitialization('web app is up.');
});
