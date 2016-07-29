//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

var express = require('express');
var router = express.Router();

var cachedPackageInformation = null;

// Super-synchronous but rarely used page...
function getPackageInfo() {
  if (cachedPackageInformation) {
    return cachedPackageInformation;
  }
  var thisPackage = require('../package.json');
  cachedPackageInformation = {};
  for (var dependency in thisPackage.dependencies) {
    var componentPackage = require('../node_modules/' + dependency + '/package.json');
    if (componentPackage && componentPackage.homepage) {
      cachedPackageInformation[dependency] = {
        homepage: componentPackage.homepage,
        description: componentPackage.description,
      };
    }
  }
  return cachedPackageInformation;
}

router.get('/', function (req, res) {
  var config = req.app.settings.runtimeConfig.obfuscatedConfig;
  var components = getPackageInfo();
  res.render('thanks', {
    config: config,
    components: components,
    serviceBanner: config && config.serviceBanner ? config.serviceBanner : undefined,
    title: 'Open Source Components',
  });
});

module.exports = router;
