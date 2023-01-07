//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Scrub the incoming URL value(s) in the request, replacing tokens and other
// secrets.
export default function (req, res, next) {
  let url = req.originalUrl || req.url;
  const secretKeys = ['code', 'token'];
  for (let i = 0; i < secretKeys.length; i++) {
    const key = secretKeys[i];
    const value = req.query[key];
    if (value !== undefined) {
      url = url.replace(key + '=' + value, key + '=*****');
    }
  }
  req.scrubbedUrl = url;
  next();
}
