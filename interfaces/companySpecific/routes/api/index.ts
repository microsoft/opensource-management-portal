//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { ConnectRouter } from '..';

export interface IAttachCompanySpecificRoutesApi {
  rootIndex?: ConnectRouter;
  index?: ConnectRouter;
  context?: IAttachCompanySpecificRoutesApiContextual;
  organization?: IAttachCompanySpecificRoutesApiOrganization;
  people?: ConnectRouter;
}

export interface IAttachCompanySpecificRoutesApiContextual {
  index?: ConnectRouter;
  organization?: IAttachCompanySpecificRoutesApiContextualOrganization;
  administration?: IAttachCompanySpecificRoutesApiContextualAdministration;
}

export interface IAttachCompanySpecificRoutesApiContextualOrganization {
  index?: ConnectRouter;
  repo?: ConnectRouter;
  team?: ConnectRouter;
}

export interface IAttachCompanySpecificRoutesApiContextualAdministration {
  index?: ConnectRouter;
}

export interface IAttachCompanySpecificRoutesApiOrganization {
  index?: ConnectRouter;
  repo?: ConnectRouter;
}
