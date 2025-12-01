//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import createEnvironmentFileResolver from './environmentFileReader.js';

const resolver = createEnvironmentFileResolver(
  'corporate.trainingResources.js',
  'urls',
  'CONFIGURATION_ENVIRONMENT'
);

export default resolver;
