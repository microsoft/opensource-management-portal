//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import { Router } from 'express';
import asyncHandler from 'express-async-handler';

import { jsonError } from '../../../middleware/jsonError';
import {
  AuthorizeOnlyCorporateAdministrators,
  checkIsCorporateAdministrator,
  getIsCorporateAdministrator,
} from '../../../middleware';
import {
  IReposAppRequestWithOrganizationManagementType,
  OrganizationManagementType,
} from '../../../middleware/business/organization';
import {
  IOrganizationAnnotationChange,
  OrganizationAnnotation,
} from '../../../entities/organizationAnnotation';
import { ErrorHelper, getProviders } from '../../../transitional';
import { IndividualContext } from '../../../business/user';
import { IProviders } from '../../../interfaces';

const router: Router = Router();

type IRequestWithOrganizationAnnotations = IReposAppRequestWithOrganizationManagementType & {
  annotations: OrganizationAnnotation;
};

router.use(
  '/',
  checkIsCorporateAdministrator,
  asyncHandler(async (req: IRequestWithOrganizationAnnotations, res, next) => {
    const { organizationAnnotationsProvider } = getProviders(req);
    const { organization, organizationManagementType, organizationProfile } = req;
    const organizationId =
      organizationManagementType === OrganizationManagementType.Managed
        ? organization.id
        : organizationProfile.id;
    try {
      req.annotations = await organizationAnnotationsProvider.getAnnotations(organizationId);
    } catch (error) {
      if (!ErrorHelper.IsNotFound(error)) {
        return next(error);
      }
    }
    return next();
  })
);

router.get(
  '/',
  asyncHandler(async (req: IRequestWithOrganizationAnnotations, res, next) => {
    const { annotations } = req;
    // Limited redaction
    const isSystemAdministrator = await getIsCorporateAdministrator(req);
    if (!isSystemAdministrator && annotations.administratorNotes) {
      annotations.administratorNotes = '*****';
    }
    if (!isSystemAdministrator && annotations?.history?.length > 0) {
      delete annotations.history;
    }
    return res.json({
      isSystemAdministrator,
      annotations,
    });
  })
);

async function ensureAnnotations(req: IRequestWithOrganizationAnnotations, res, next) {
  if (!req.annotations) {
    const { organizationAnnotationsProvider } = getProviders(req);
    try {
      const annotations = new OrganizationAnnotation();
      annotations.organizationId = req.organizationProfile.id;
      annotations.created = new Date();
      await organizationAnnotationsProvider.insertAnnotations(annotations);
      req.annotations = annotations;
    } catch (error) {
      return next(error);
    }
  }
  return next();
}

router.patch('*', AuthorizeOnlyCorporateAdministrators, ensureAnnotations);
router.put('*', AuthorizeOnlyCorporateAdministrators, ensureAnnotations);

router.put(
  '/',
  asyncHandler(async (req: IRequestWithOrganizationAnnotations, res, next) => {
    // No-op mostly, since ensureAnnotations precedes
    return res.json({
      annotations: req.annotations,
    });
  })
);

function addChangeNote(
  changes: IOrganizationAnnotationChange[],
  context: IndividualContext,
  fieldName: string,
  beforeAsText: string,
  afterAsText: string,
  optionalText?: string
) {
  const beforeText = beforeAsText || '(none)';
  const afterText = afterAsText || '(none)';
  const changedByDisplay =
    context.corporateIdentity?.displayName ||
    context.corporateIdentity?.username ||
    context.corporateIdentity?.id ||
    'unknown';
  changes.push({
    date: new Date(),
    corporateId: context.corporateIdentity.id,
    displayName: context.corporateIdentity?.displayName,
    text: optionalText || `${changedByDisplay} updated ${fieldName}`,
    details: `${changedByDisplay} changed ${fieldName} from "${beforeText}" to "${afterText}"`,
  });
}

// Properties

router.put(
  '/property/:propertyName',
  asyncHandler(async (req: IRequestWithOrganizationAnnotations, res, next) => {
    const { annotations } = req;
    const providers = getProviders(req);
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    const changes: IOrganizationAnnotationChange[] = [];
    const newValue = req.body.value as string;
    if (!newValue) {
      return next(jsonError('body.value required', 400));
    }
    if (typeof newValue !== 'string') {
      return next(jsonError('body.value must be a string value', 400));
    }
    const propertyName = req.params.propertyName as string;
    const currentPropertyValue = annotations.properties[propertyName] || null;
    const updateDescription = `Changing property ${propertyName} value from "${currentPropertyValue}" to "${newValue}"`;
    annotations.properties[propertyName] = newValue;
    addChangeNote(changes, activeContext, 'property', currentPropertyValue, newValue, updateDescription);
    const updated = await applyPatch(providers, annotations, changes);
    return res.json({
      annotations,
      updated,
    });
  })
);

router.delete(
  '/property/:propertyName',
  asyncHandler(async (req: IRequestWithOrganizationAnnotations, res, next) => {
    const { annotations } = req;
    const providers = getProviders(req);
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    const changes: IOrganizationAnnotationChange[] = [];
    const propertyName = req.params.propertyName as string;
    const currentPropertyValue = annotations.properties[propertyName] || null;
    if (annotations.properties[propertyName] === undefined) {
      return next(jsonError(`property ${propertyName} is not set`, 400));
    }
    delete annotations.properties[propertyName];
    addChangeNote(
      changes,
      activeContext,
      'property',
      currentPropertyValue,
      null,
      `Removed the ${propertyName} property`
    );
    const updated = await applyPatch(providers, annotations, changes);
    return res.json({
      annotations,
      updated,
    });
  })
);

// Feature flags

router.put(
  '/feature/:flag',
  asyncHandler(async (req: IRequestWithOrganizationAnnotations, res, next) => {
    const { annotations } = req;
    const providers = getProviders(req);
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    const changes: IOrganizationAnnotationChange[] = [];
    const flag = req.params.flag as string;
    if (annotations.features.includes(flag)) {
      return next(jsonError(`The feature flag ${flag} is already present`, 400));
    }
    annotations.features.push(flag);
    addChangeNote(
      changes,
      activeContext,
      'feature flags',
      `did not have ${flag} feature`,
      `${flag} feature added`,
      `Added the ${flag} flag`
    );
    const updated = await applyPatch(providers, annotations, changes);
    return res.json({
      annotations,
      updated,
    });
  })
);

router.delete(
  '/feature/:flag',
  asyncHandler(async (req: IRequestWithOrganizationAnnotations, res, next) => {
    const { annotations } = req;
    const providers = getProviders(req);
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    const changes: IOrganizationAnnotationChange[] = [];
    const flag = req.params.flag as string;
    if (!annotations.features.includes(flag)) {
      return next(jsonError(`The feature flag ${flag} is not set`, 400));
    }
    annotations.features = annotations.features.filter((f) => f !== flag);
    addChangeNote(
      changes,
      activeContext,
      'feature flags',
      `${flag} feature`,
      `${flag} feature removed`,
      `Removed the ${flag} flag`
    );
    const updated = await applyPatch(providers, annotations, changes);
    return res.json({
      annotations,
      updated,
    });
  })
);

// General values patch

router.patch(
  '/',
  asyncHandler(async (req: IRequestWithOrganizationAnnotations, res, next) => {
    const { annotations } = req;
    const providers = getProviders(req);
    const activeContext = (req.individualContext || req.apiContext) as IndividualContext;
    const changes: IOrganizationAnnotationChange[] = [];
    const { administratorNotes, notes } = req.body;
    if (administratorNotes !== undefined && administratorNotes !== annotations.administratorNotes) {
      addChangeNote(
        changes,
        activeContext,
        'administrator notes',
        annotations.administratorNotes,
        administratorNotes
      );
      annotations.administratorNotes = administratorNotes;
    }
    if (notes !== undefined && notes !== annotations.notes) {
      addChangeNote(changes, activeContext, 'notes', annotations.notes, notes);
      annotations.notes = notes;
    }
    const updated = await applyPatch(providers, annotations, changes);
    return res.json({
      annotations,
      updated,
    });
  })
);

async function applyPatch(
  providers: IProviders,
  annotations: OrganizationAnnotation,
  changes: IOrganizationAnnotationChange[]
) {
  if (changes.length) {
    changes.reverse();
    annotations.history = [...changes, ...annotations.history];
    annotations.updated = new Date();
    const { organizationAnnotationsProvider } = providers;
    await organizationAnnotationsProvider.replaceAnnotations(annotations);
  }
  return changes.length > 0;
}

// directOwnersIds, directOwnersSecurityGroupId
// features, properties
// flag

router.use('*', (req, res, next) => {
  return next(jsonError('no API or function available within the organization annotations route', 404));
});

export default router;
