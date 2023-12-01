//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { PageInfoForward } from '@octokit/plugin-paginate-graphql';

export type IteratorResponse<T> = {
  nodes: T[];
  pageInfo: PageInfoForward;
};

export type IteratorPickerResponse<T> = {
  select: (response: any) => IteratorResponse<T>;
  nodes: (response: any) => T[];
  pageInfo: (response: any) => PageInfoForward;
};

export type PaginationPageSizeOptions = {
  pageSize?: number;
};

export function decorateIterable<T, Q>(iterable: AsyncIterable<any>, objectPath: string) {
  const o = iterable as any as IteratorPickerResponse<T>;
  o.select = (response: any) => {
    const keys = objectPath.split('.');
    let current = response;
    for (let i = 0; i < keys.length; i++) {
      current = current[keys[i]];
      if (!current) {
        throw new Error(`Could not find ${keys[i]} in ${objectPath} of decorated iterable response`);
      }
    }
    return current;
  };
  o.nodes = (response: any) => {
    return o.select(response).nodes;
  };
  o.pageInfo = (response: any) => {
    return o.select(response).pageInfo;
  };
  return o as IteratorPickerResponse<T> & AsyncIterable<Q>;
}
