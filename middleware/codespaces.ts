//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ReposAppRequest } from '../interfaces';

// Assistant for when using Visual Studio Code to connect to a Codespace
// locally instead of the web. The default port forwarding experience is
// to toast the user to browse to 127.0.0.1:3000, but since AAD does not
// allow for IP-based callback URLs, the user must use localhost.
export function codespacesDevAssistant(req: ReposAppRequest, res, next) {
  if (req.hostname === '127.0.0.1') {
    console.warn(
      `${req.method} ${req.url}: WARNING: You're trying to connect to ${req.hostname} from your codespace.`
    );
    if (req.method === 'GET') {
      res.contentType('text/html');
      return res.send(`
        <html>
          <body>
            <h1>WARNING: You're trying to connect to ${req.hostname} from your codespace.</h1>
            <p>Use <a href="http://localhost:3000${req.url}">http://localhost:3000${req.url}</a> instead.</p>
          </body>
        </html>
      `);
    }
  }

  return next();
}
