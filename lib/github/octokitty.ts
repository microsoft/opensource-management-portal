//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Endpoints } from './octokitty.endpoints.js';

// import { RestEndpointMethods } from '@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types';
// import { EndpointsDefaultsAndDecorations } from '@octokit/plugin-rest-endpoint-methods/dist-types/types';

export type OctokitMethodMetadata = {
  octokitMethodName: string;
};

let endpointMap: Map<string, string> = null;

export async function endpointToOctokitMethod(method: string, endpoint: string): Promise<string> {
  if (!endpointMap) {
    endpointMap = createEndpointMap(Endpoints);
  }
  const combined = `${method} ${endpoint}`;
  return endpointMap.get(combined);
}

function createEndpointMap(endpoints) {
  endpointMap = new Map<string, string>();

  function exploreObject(obj, path = '') {
    if (Array.isArray(obj) && typeof obj[0] === 'string') {
      endpointMap.set(obj[0], path);
    } else {
      for (const key in obj) {
        if (typeof obj[key] === 'object') {
          exploreObject(obj[key], `${path}${path.length > 0 ? '.' : ''}${key}`);
        }
      }
    }
  }

  exploreObject(endpoints);
  return endpointMap;
}
