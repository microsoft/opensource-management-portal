//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IMailAddressProvider } from '.';

export default function createMailAddressProvider(): IMailAddressProvider {
  return {
    getAddressFromUpn: async (upn: string) => {
      return upn;
    },
  };
}
