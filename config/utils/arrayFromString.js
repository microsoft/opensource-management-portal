//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

// Split and set an optional array, or empty array, trimming each. If the
// input is actually an array, just pass it back.
export default function (a, split) {
  if (!split) {
    split = ',';
  }
  if (a && Array.isArray(a)) {
    return a;
  }
  var b = a && a.split ? a.split(split) : [];
  if (b && b.length) {
    for (var i = 0; i < b.length; i++) {
      b[i] = b[i].trim();
    }
  }
  return b;
}
