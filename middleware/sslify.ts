//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import sslify from 'express-sslify';

import type { ConfigWebServer } from '../config/webServer.types';

export default function (webServerConfig: ConfigWebServer) {
  if (webServerConfig.sslify?.enabled) {
    const options = {
      trustProtoHeader: webServerConfig.sslify.trustProtoHeader,
      trustAzureHeader: webServerConfig.sslify.trustAzureHeader,
    };
    return sslify.HTTPS(options);
  }
}
