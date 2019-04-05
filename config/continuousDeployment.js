//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const pkg = require('../package.json');

module.exports = () => {
  // Useful information to help understand which CI/CD pipeline the app came from
  const continuousDeployment = pkg.continuousDeployment || {};
  continuousDeployment.version = pkg.version;
  continuousDeployment.name = pkg.name;
  return continuousDeployment;
};
