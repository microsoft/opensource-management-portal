//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

module.exports = () => {
  // Useful information to help understand which CI/CD pipeline the app came from
  const packageJson = require('../package.json');
  const continuousDeployment = packageJson.continuousDeployment || {};
  continuousDeployment.version = packageJson.version;
  continuousDeployment.name = packageJson.name;
  return continuousDeployment;
};