//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const async = require('async');
const fs = require('fs');
const tmp = require('tmp');
const zlib = require('zlib');

function deflateFile(inputFilename, outputFilename, callback) {
  const gzip = zlib.createGzip();
  const input = fs.createReadStream(inputFilename);
  const output = fs.createWriteStream(outputFilename);
  input.pipe(gzip).pipe(output);
  output.on('finish', callback);
}

function getTempFilenames(count, callback) {
  const filenames = [];
  async.whilst(
    () => filenames.length !== count,
    (next) => {
      tmp.tmpName((tempGenerationError, tempPath) => {
        if (tempGenerationError) {
          return next(tempGenerationError);
        }
        filenames.push(tempPath);
        next();
      });
    }, function (error) {
      if (error) {
        return callback(error);
      }
      callback(null, filenames);
    });
}

module.exports.writeDeflatedTextFile = function writeDeflatedText(text, callback) {
  // The callback will be the deflated temporary filename, removed after the process exits.
  getTempFilenames(2, (tempFilesError, filenames) => {
    if (tempFilesError) {
      return callback(tempFilesError);
    }
    const intermediate = filenames[0];
    const deflatedPath = filenames[1];
    // Direct piping was crashing in the past so using two temporary files for robustness.
    fs.writeFile(intermediate, text, (writeError) => {
      if (writeError) {
        return callback(writeError);
      }
      deflateFile(intermediate, deflatedPath, (deflateError) => {
        if (deflateError) {
          return callback(deflateError);
        }
        callback(null, deflatedPath);
      });
    });
  });
};

module.exports.deflateFile = deflateFile;
