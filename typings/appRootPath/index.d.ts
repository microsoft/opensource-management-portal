//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

declare module 'app-root-path' {
  export function resolve(pathToModule: string): string;
  export const path: string;
  export function toString(): string;
  export function setPath(explicitlySetPath: string): void;
  export function require(pathToModule: string): any;
}
