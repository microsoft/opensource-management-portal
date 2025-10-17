//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import type { ICorporateLink } from '../index.js';

export type LinkEvent = ICorporateLink & {
  linkId: string;
  correlationId: string;
};

export type UnlinkEvent = {
  github: {
    id: number;
    login: string;
  };
  aad: {
    preferredName: string;
    userPrincipalName: string;
    id: string;
  };
};
