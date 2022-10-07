//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import fs from 'fs';
import zlib from 'zlib';
import tmp from 'tmp-promise';

export function deflateFile(inputFilename: string, outputFilename: string, callback) {
  const gzip = zlib.createGzip();
  const input = fs.createReadStream(inputFilename);
  const output = fs.createWriteStream(outputFilename);
  input.pipe(gzip).pipe(output);
  output.on('finish', callback);
}

function getTempFilenames(count: number, callback) {
  const filenames = [];
  async function process() {
    while (filenames.length !== count) {
      const result = await tmp.file();
      filenames.push(result.path);
    }
  }
  process()
    .then((ok) => {
      return callback(null, filenames);
    })
    .catch((error) => {
      return callback(error);
    });
}

export function writeDeflatedTextFile(text, callback) {
  // The callback will be the deflated temporary filename, removed after the process exits.
  return getTempFilenames(2, (tempFilesError, filenames) => {
    if (tempFilesError) {
      return callback(tempFilesError);
    }
    const intermediate = filenames[0];
    const deflatedPath = filenames[1];
    // Direct piping was crashing in the past so using two temporary files for robustness.
    return fs.writeFile(intermediate, text, (writeError) => {
      if (writeError) {
        return callback(writeError);
      }
      return deflateFile(intermediate, deflatedPath, (deflateError) => {
        if (deflateError) {
          return callback(deflateError);
        }
        return callback(null, deflatedPath);
      });
    });
  });
}
