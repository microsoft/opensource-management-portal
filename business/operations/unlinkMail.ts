//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Operations } from '.';
import { Account } from '../account';
import { UnlinkPurpose, IUnlinkMailStatus, ICachedEmployeeInformation } from '../../interfaces';
import getCompanySpecificDeployment from '../../middleware/companySpecificDeployment';
import { assertUnreachable } from '../../lib/transitional';

export async function sendTerminatedAccountMail(
  operations: Operations,
  account: Account,
  purpose: UnlinkPurpose,
  details: string[],
  errorsCount: number
): Promise<IUnlinkMailStatus> {
  const { config, mailProvider, insights } = operations.providers;
  if (!mailProvider || !account.link || !account.link.corporateId) {
    return null;
  }
  const link = account.link;
  const companySpecific = getCompanySpecificDeployment();

  purpose = purpose || UnlinkPurpose.Unknown;
  let sendNoticeToLinkHolder = false;
  switch (purpose) {
    case UnlinkPurpose.Deleted:
    case UnlinkPurpose.Operations:
    case UnlinkPurpose.Self: {
      sendNoticeToLinkHolder = true;
      break;
    }
    case UnlinkPurpose.Unknown:
    case UnlinkPurpose.Termination: {
      sendNoticeToLinkHolder = false;
      break;
    }
    default: {
      assertUnreachable(purpose);
    }
  }

  const operationsMail = operations.getLinksNotificationMailAddress();
  let displayName = link.corporateDisplayName || link.corporateUsername || link.corporateId;
  let subjectPrefix = '';
  let subjectSuffix = '';
  let headline = `${displayName} has been unlinked from GitHub`;
  switch (purpose) {
    case UnlinkPurpose.Self:
      headline = `${displayName} unlinked themselves from GitHub`;
      subjectPrefix = 'FYI: ';
      subjectSuffix = ' [self-service remove]';
      break;
    case UnlinkPurpose.Deleted:
      subjectPrefix = 'FYI: ';
      subjectSuffix = '[account deleted]';
      headline = `${displayName} deleted their GitHub account`;
      break;
    case UnlinkPurpose.Operations:
      subjectPrefix = 'FYI: ';
      subjectSuffix = ' [corporate GitHub operations]';
      break;
    case UnlinkPurpose.Termination:
      subjectPrefix = '[UNLINKED] ';
      headline = `${displayName} has had their GitHub access offboarded`;
      break;
    case UnlinkPurpose.Unknown:
    default:
      subjectSuffix = ' [unknown]';
      break;
  }

  if (sendNoticeToLinkHolder) {
    try {
      const mail = {
        to: link.corporateMailAddress || link.corporateUsername || operationsMail,
        cc: link.corporateMailAddress || link.corporateUsername ? operationsMail : [],
        subject: `${subjectPrefix}${
          link.corporateUsername || displayName
        } unlinked from GitHub ${subjectSuffix}`.trim(),
        content: undefined,
      };
      const viewName = companySpecific?.views?.email?.linking?.unlink || 'unlink';
      mail.content = await operations.emailRender(viewName, {
        reason: `This is a mandatory notice: your GitHub account and corporate identity have been unlinked. This mail was sent to: ${
          link.corporateMailAddress || link.corporateUsername
        }`,
        headline,
        notification: 'information',
        app: `${config.brand.companyName} GitHub`,
        link: account.link,
        companyName: config.brand.companyName,
        purpose,
        details,
      });
      const selfReceipt = await operations.sendMail(Object.assign(mail));
      insights?.trackEvent({
        name: 'UnlinkMailSentToAccount',
        properties: {
          purpose,
          corporateId: link.corporateId,
          viewName,
          selfReceipt,
        },
      });
    } catch (sendNoticeError) {
      insights?.trackException({ exception: sendNoticeError });
      console.warn(sendNoticeError);
    }
  }

  let errorMode = errorsCount > 0;

  if (!operationsMail && errorMode) {
    return;
  }
  const operationsArray = operationsMail.split(',');

  let cachedEmployeeManagementInfo: ICachedEmployeeInformation = null;
  let upn = account.link.corporateUsername || account.link.corporateId;
  try {
    cachedEmployeeManagementInfo = await operations.getCachedEmployeeManagementInformation(
      account.link.corporateId
    );
    if (!cachedEmployeeManagementInfo || !cachedEmployeeManagementInfo.managerMail) {
      cachedEmployeeManagementInfo = {
        id: account.link.corporateId,
        displayName,
        userPrincipalName: upn,
        managerDisplayName: null,
        managerId: null,
        managerMail: null,
      };
      throw new Error(
        `No manager e-mail address or information retrieved from a previous cache for corporate user ID ${account.link.corporateId}`
      );
    }
    if (cachedEmployeeManagementInfo.displayName) {
      displayName = cachedEmployeeManagementInfo.displayName;
    }
    if (cachedEmployeeManagementInfo.userPrincipalName) {
      upn = cachedEmployeeManagementInfo.userPrincipalName;
    }
  } catch (getEmployeeInfoError) {
    errorMode = true;
    details.push(getEmployeeInfoError.toString());
  }

  let to: string[] = [];
  if (errorMode) {
    to.push(...operationsArray);
  } else {
    to.push(cachedEmployeeManagementInfo.managerMail);
  }
  to = to.filter((val) => val);
  const bcc = [];
  if (!errorMode) {
    bcc.push(...operationsArray);
  }
  const toAsString = to.join(', ');
  const mail = {
    to,
    bcc,
    subject: `${subjectPrefix}${upn || displayName} unlinked from GitHub ${subjectSuffix}`.trim(),
    category: ['link'],
    content: undefined,
  };
  const managerViewName = companySpecific?.views?.email?.linking?.unlinkManager || 'managerunlink';
  mail.content = await operations.emailRender(managerViewName, {
    reason: `As a manager you receive one-time security-related messages regarding your direct reports who have linked their GitHub account to the company.
              This mail was sent to: ${toAsString}`,
    headline,
    notification: 'information',
    app: `${config.brand.companyName} GitHub`,
    link: account.link,
    companyName: config.brand.companyName,
    managementInformation: cachedEmployeeManagementInfo,
    purpose,
    details,
  });
  return {
    to,
    bcc,
    receipt: await operations.sendMail(Object.assign(mail)),
  };
}
