//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ConnectRouter } from '..';

export interface IAttachCompanySpecificRoutesApi {
  index?: ConnectRouter;
  context?: IAttachCompanySpecificRoutesApiContextual;
  organization?: IAttachCompanySpecificRoutesApiOrganization;
  people?: ConnectRouter;
}

export interface IAttachCompanySpecificRoutesApiContextual {
  index?: ConnectRouter;
  organization?: IAttachCompanySpecificRoutesApiContextualOrganization;
}

export interface IAttachCompanySpecificRoutesApiContextualOrganization {
  index?: ConnectRouter;
  repo?: ConnectRouter;
}

export interface IAttachCompanySpecificRoutesApiOrganization {
  index?: ConnectRouter;
  repo?: ConnectRouter;
}
