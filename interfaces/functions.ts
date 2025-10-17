//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { IReposError } from './errors.js';

export interface ICallback<T> {
  (error: IReposError, result?: T): void;
}

export interface IFunctionPromise<T> {
  (): Promise<T>;
}

export interface PromiseResolve<T> {
  (resolve: T[]): void;
}

export interface PromiseReject {
  (reject?: any): void;
}

export interface IDictionary<TValue> {
  [id: string]: TValue;
}

export interface ISettledValue<T> {
  reason?: any;
  value?: T;
  state: SettledState;
}

export enum SettledState {
  Fulfilled = 'fulfilled',
  Rejected = 'rejected',
}
