//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export interface IReposError extends Error {
  skipLog?: boolean;
  status?: any; // status?: number;
  code?: any; // not sure this is used any longer by libraries
  originalUrl?: any;
  detailed?: any;
  title?: string;
  redirect?: string;
  skipOops?: boolean;
  fancyLink?: {
    link: string;
    title: string;
  };
  fancySecondaryLink?: {
    link: string;
    title: string;
  };
}
