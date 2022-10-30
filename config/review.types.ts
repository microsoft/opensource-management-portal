//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

export type ConfigRootReview = {
  review: ConfigReview;
};

export type ConfigReview = {
  aadAppIdUri: string;
  serviceUrl: string;
};
