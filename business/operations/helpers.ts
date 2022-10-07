//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import _ from 'lodash';

import { Operations } from '.';

type PrioritizedOptions = {
  shufflePrimary?: boolean;
  shuffleSecondary?: boolean;
  shuffleRemaining?: boolean;
};

export function getPrioritizedOrganizationsList(operations: Operations, options?: PrioritizedOptions) {
  const organizations = operations.getOrganizations();
  const absoluteFirst = organizations.filter((o) =>
    o.getDynamicSettings().hasFeature('official-company-organization')
  );
  const primary = organizations.filter((o) => o.getDynamicSettings().getProperty('priority') === 'primary');
  const secondary = organizations.filter(
    (o) => o.getDynamicSettings().getProperty('priority') === 'secondary'
  );
  const list = Array.from(
    new Set([
      ...absoluteFirst,
      ...(options?.shufflePrimary ? _.shuffle(primary) : primary),
      ...(options?.shuffleSecondary ? _.shuffle(secondary) : secondary),
      ...(options?.shuffleRemaining ? _.shuffle(organizations) : organizations),
    ])
  );
  return list;
}
