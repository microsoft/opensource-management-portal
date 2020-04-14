//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { AuthenticationContext, ErrorResponse, TokenResponse } from 'adal-node';

// import { ReviewServiceClient } from '@ospo/review-service-client';

const authContext = new AuthenticationContext('https://login.microsoftonline.com/common');

interface IReviewServiceClient {
  constructor(host: string, tokenProvider: unknown);
  submitContribution(contributionSubmission: any, referer: string): Promise<unknown>;
  submitIpScanRequest(ipScanRequestSubmission: any, referer: string): Promise<unknown>;
  getIpScanRequest(component: any): Promise<unknown>;
  getReviewUrl(uri: string): string;
  getReviewByUri(uri: string): Promise<unknown>;
  getGuidanceByHash(hash: string): Promise<{
      url: string;
      content: string;
  } | undefined>;
  getGuidanceByReviewUri(uri: string): Promise<{
      url: string;
      content: string;
  } | undefined>;
  startSnapshotIpScanStatusJob(accountName: string, projectName: string, governedRepositoryName: string, snapshotId: number, accessToken: string): Promise<unknown>;
  getSnapshotIpScanStatusResult(jobId: string): Promise<unknown>;
  getRegistrationIpScanStatus(accountName: string, projectId: string, governedRepositoryId: number, registrationId: number, accessToken: string): Promise<unknown>;
  getSnapshotIpScanStatusUrls(accountName: string, projectId: string, governedRepositoryId: number, registrationId: number, accessToken: string): Promise<unknown>;
  submitReleaseRequestBatch(releaseRequestSubmissions: any): Promise<unknown>;
  getAllReleaseReviews(): Promise<unknown>;
}

let instance: IReviewServiceClient; // ReviewServiceClient;

const ospoReviewModuleName = '@ospo/review-service-client';

export function getReviewService(config: Config) {
  if (instance) {
    return instance;
  }

  try {
    const { ReviewServiceClient } = require(ospoReviewModuleName);
    instance = new ReviewServiceClient(config.review.serviceUrl, getAccessToken) as unknown as IReviewServiceClient;
    return instance;
  } catch (reviewServiceClientRequireError) {
    console.warn(`The private module ${ospoReviewModuleName} is not available, the review service is not be available`);
  }

  function getAccessToken() {
    const { clientId, clientSecret } = config.activeDirectory;
    const resource = config.review.aadAppIdUri;

    return new Promise<TokenResponse['accessToken']>((resolve, reject) =>
      authContext.acquireTokenWithClientCredentials(resource, clientId, clientSecret,
        (error, response) => isAadToken(response) ? resolve(response.accessToken) : reject(error)))
  }
};

function isAadToken(res: TokenResponse | ErrorResponse): res is TokenResponse {
  return (<TokenResponse>res).error === undefined;
}

type Config = {
  review: Record<'serviceUrl' | 'aadAppIdUri', string>;
  activeDirectory: Record<'clientId'|'clientSecret', string>
}
