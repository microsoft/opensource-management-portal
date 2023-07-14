//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

const fs = require('fs');
const path = require('path');
const jsonc = require('jsonc');

module.exports = function retrieveEnvironment(name, type, options) {
  type = type || 'env';
  options = options || {};
  const throwOnError = options.throwOnError !== undefined ? options.throwOnError : true;
  const environmentPath = path.join(__dirname, type, name);
  try {
    // Attempt JSON with comments first
    let jsonPath = environmentPath.endsWith('.jsonc') ? environmentPath : `${environmentPath}.jsonc`;
    fs.statSync(jsonPath);
    const fileContents = fs.readFileSync(jsonPath, 'utf8');
    const values = jsonc.parse(fileContents);
    if (values) {
      return values;
    }
  } catch (jsonDoesNotExist) {
    if (jsonDoesNotExist.code === 'ENOENT') {
      // expected
    } else {
      console.warn(jsonDoesNotExist);
    }
  }
  try {
    const values = require(environmentPath);
    return values;
  } catch (requireError) {
    const message = `Unable to require environment ${type}/${name} via ${environmentPath}`;
    if (throwOnError) {
      const error = new Error(message);
      error.innerError = requireError;
      throw error;
    } else {
      console.error(message);
    }
  }
};
