//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

import { EntityMetadataType, EntityMetadataBase } from '../../lib/entityMetadataProvider/entityMetadata';
import { LocalExtensionKey, EnsureLocalExtensionKeyDefinitionsAvailable } from './localExtensionKey';
import { ILocalExtensionKeyProvider, ILocalExtensionKeyProviderOptions } from '.';

const thisProviderType = EntityMetadataType.LocalExtensionKey;

export class LocalExtensionKeyProvider extends EntityMetadataBase implements ILocalExtensionKeyProvider {
  constructor(options: ILocalExtensionKeyProviderOptions) {
    super(options);
    EnsureLocalExtensionKeyDefinitionsAvailable();
  }

  async getForCorporateId(corporateId: string): Promise<LocalExtensionKey> {
    this.ensureHelpers(thisProviderType);
    const metadata = await this._entities.getMetadata(thisProviderType, corporateId);
    return this.deserialize<LocalExtensionKey>(thisProviderType, metadata);
  }

  async createNewForCorporateId(localExtensionKey: LocalExtensionKey): Promise<void> {
    const entity = this.serialize(thisProviderType, localExtensionKey);
    await this._entities.setMetadata(entity);
  }

  async updateForCorporateId(localExtensionKey: LocalExtensionKey): Promise<void> {
    const entity = this.serialize(thisProviderType, localExtensionKey);
    return await this._entities.updateMetadata(entity);
  }

  async delete(localExtensionKey: LocalExtensionKey): Promise<void> {
    const entity = this.serialize(thisProviderType, localExtensionKey);
    return await this._entities.deleteMetadata(entity);
  }
}
