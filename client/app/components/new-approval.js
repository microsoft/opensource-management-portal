import Ember from 'ember';

export default Ember.Component.extend({
  ajax: Ember.inject.service(),
  flashMessages: Ember.inject.service(),
  spinner: Ember.inject.service('spinner'),

  technologyAreas: [
    'Connectivity (Physical, Protocols)',
    'Cloud and Big Data (Virtualization, Infrastructure, Cloud App Services, Database)',
    'Semiconductor (CPU, GPU, Power, Semi Processing and Packaging)',
    'Content Creation (Word Processor, Spreadsheet)',
    'UI (GUI, Gestures, SW Oriented)',
    'Multimedia (Audio/Video Codecs, Camera Tech)',
    'Base OS (Linux/Android)',
    'Security (Encryption, Malware, Identity)',
    'Analytics (Search and Ads)',
    'Display, Sensors and Touch',
    'Other'
  ],
  projectTypes: [
    { id: 'product code', text: 'Product code' },
    { id: 'sdk', text: 'SDK' },
    { id: 'sample code', text: 'Sample code' },
    { id: 'documentation', text: 'Documentation' },
    { id: 'utility library / tool', text: 'Utility library / tool' },
    { id: 'other', text: 'Other' }
  ],
  policyExemptionJustifications: [
    'Inner-source / Internal shared source',
    'Team project',
    'Hackathon project',
    'Personal project'
  ],
  shouldSizeQuestionBeAsked: Ember.computed('approval.{projectType,license,includes3rdparty,sendsDataToMicrosoft}', function () {
    if (['sample code', 'documentation', 'utility library / tool'].includes(this.get('approval.projectType')) &&
      this.get('approval.license') === 'MIT' && this.get('approval.includes3rdparty') === 'No' && this.get('approval.sendsDataToMicrosoft') === 'No') {
      return true;
    }
    return false;
  }),
  shouldDisplayRemainingQuestions: Ember.computed('{shouldSizeQuestionBeAsked,approval.smallProject}', function () {
    if (['product code', 'sdk', 'other'].includes(this.get('approval.projectType')) ||
      this.get('approval.license') === 'Other' || this.get('approval.includes3rdparty') === 'Yes' || this.get('approval.sendsDataToMicrosoft') === 'Yes') {
      return true;
    }
    if (!Ember.isEmpty(this.get('approval.projectType')) && !Ember.isEmpty(this.get('approval.includes3rdparty')) &&
      !Ember.isEmpty(this.get('approval.sendsDataToMicrosoft'))) {
      if (this.get('shouldSizeQuestionBeAsked')) {
        if (!Ember.isEmpty(this.get('approval.smallProject')) && this.get('approval.smallProject') === 'No') {
          return true;
        }
      } else {
        return true;
      }
    }
    return false;
  }),

  actions: {
    next(approval) {
      if (approval.get('publicOpenSource') === 'No' && approval.validate({ only: ['policyExemptionJustification', 'confirmedPolicyException'] })) {
        this.resetAllValues(approval, ['publicOpenSource', 'policyExemptionJustification', 'confirmedPolicyException', 'license', 'hosting']);
        return this.sendAction('routeActionName', approval);
      }
      if (this.get('shouldSizeQuestionBeAsked') && approval.get('smallProject') === 'Yes') {
        this.resetAllValues(approval, ['publicOpenSource', 'projectType', 'license', 'includes3rdparty', 'sendsDataToMicrosoft', 'smallProject', 'hosting']);
        return this.sendAction('routeActionName', approval);
      }
      if (approval.validate()) {
        this.sanitizeValues(approval);
        this.sendAction('routeActionName');
      }
    },
    validateProjectName() {
      this.get('approval').validate({ only: ['projectName'] });
    },
    validateProjectVersion() {
      this.get('approval').validate({ only: ['projectVersion'] });
    },
    validateProjectDescription() {
      this.get('approval').validate({ only: ['projectDescription'] });
    },
    validateBusinessGoals() {
      this.get('approval').validate({ only: ['businessGoals'] });
    },
    validateUsage() {
      this.get('approval').validate({ only: ['usage'] });
    },
    validateIncludes3rdpartyDetails() {
      this.get('approval').validate({ only: ['includes3rdpartyDetails'] });
    },
    validateNaturalUIDetails() {
      this.get('approval').validate({ only: ['naturalUIDetails'] });
    },
    validateMultimediaCodecDetails() {
      this.get('approval').validate({ only: ['multimediaCodecDetails'] });
    },
    validateBackendSearchDetails() {
      this.get('approval').validate({ only: ['backendSearchDetails'] });
    },
    validateProtocolDetails() {
      this.get('approval').validate({ only: ['protocolDetails'] });
    },
    validateModernUIDetails() {
      this.get('approval').validate({ only: ['modernUIDetails'] });
    },
    selectEntity(selection) {
      this.set(this.get('approval').set('technologyArea', selection));
    }
  },
  resetAllValues(approval, fieldsNotToBeReset = []) {
    Object.keys(approval.toJSON()).forEach(fieldName => {
      if (!fieldsNotToBeReset.includes(fieldName)) {
        approval.set(fieldName, undefined);
      }
    });
    approval.save();
  },
  sanitizeValues(approval) {
    if (approval.get('includes3rdparty') !== 'Yes') {
      approval.set('includes3rdpartyDetails', undefined);
    }
    if (approval.get('includesModernUI') !== 'Yes') {
      approval.set('modernUIDetails', undefined);
    }
    if (approval.get('license') !== 'Other') {
      ['technologyArea', 'naturalUI', 'naturalUIDetails', 'multimediaCodecs', 'multimediaCodecDetails', 'smallProject', 'policyExemptionJustification', 'confirmedPolicyException',
        'backendSearch', 'backendSearchDetails', 'connectivityProtocols', 'protocolDetails'].forEach(field => {
          approval.set(field, undefined);
        });
    }
    if (approval.get('naturalUI') !== 'Yes') {
      approval.set('naturalUIDetails', undefined);
    }
    if (approval.get('multimediaCodecs') !== 'Yes') {
      approval.set('multimediaCodecDetails', undefined);
    }
    if (approval.get('backendSearch') !== 'Yes') {
      approval.set('backendSearchDetails', undefined);
    }
    if (approval.get('connectivityProtocols') !== 'Yes') {
      approval.set('protocolDetails', undefined);
    }
    approval.save();
  }
});
