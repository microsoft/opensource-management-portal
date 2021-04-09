//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Json, IDictionary } from '../../interfaces';

export interface IQueueMessage {
  body: Json;
  identifier: string;
  customProperties: IDictionary<string>;
  unparsedBody: string;
}

export interface IQueueProcessor {
  initialize(): Promise<void>;

  receiveMessages(): Promise<IQueueMessage[]>;
  deleteMessage(message: IQueueMessage): Promise<void>;
}
