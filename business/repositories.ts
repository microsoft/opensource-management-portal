//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Repository } from './repository';

export function sortByRepositoryDate(a: Repository, b: Repository): number { // Inverted sort (newest first)
  const aa = getRecentDate(a);
  const bb = getRecentDate(b);
  return aa == bb ? 0 : (aa < bb) ? 1 : -1;
}

export function getRecentDate(repo: Repository) {
  const dates: Date[] = [
    getAsDate(repo, 'created_at'),
    getAsDate(repo, 'pushed_at'),
    getAsDate(repo, 'updated_at'),
  ].sort();
  return dates[dates.length - 1];
}

function getAsDate(repo: Repository, fieldName: string) {
  if (repo[fieldName]) {
    const val = repo[fieldName];
    if (typeof (val) === 'string') {
      return new Date(val);
    }
    return val;
  }
  return new Date(0);
}
