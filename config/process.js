//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export default function (graphApi) {
  const environmentProvider = graphApi.environment;
  return {
    get: function (envName) {
      return environmentProvider.get(envName);
    },
  };
}
