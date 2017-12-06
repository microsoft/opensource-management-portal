import DS from 'ember-data';
import Ember from 'ember';
import Validator from '../mixins/model-validator';

export default DS.Model.extend(Validator, {
  publicOpenSource: DS.attr('string'),
  policyExemptionJustification: DS.attr('string'),
  confirmedPolicyException: DS.attr('boolean', { defaultValue: false }),
  projectName: DS.attr('string'),
  projectVersion: DS.attr('string'),
  projectDescription: DS.attr('string'),
  projectType: DS.attr('string'),
  businessGoals: DS.attr('string'),
  usage: DS.attr('string'),
  license: DS.attr('string', { defaultValue: 'MIT' }),
  technologyArea: DS.attr('string'),
  naturalUI: DS.attr('string'),
  naturalUIDetails: DS.attr('string'),
  multimediaCodecs: DS.attr('string'),
  multimediaCodecDetails: DS.attr('string'),
  backendSearch: DS.attr('string'),
  backendSearchDetails: DS.attr('string'),
  connectivityProtocols: DS.attr('string'),
  protocolDetails: DS.attr('string'),
  hosting: DS.attr('string', { defaultValue: 'github' }),
  includes3rdparty: DS.attr('string'),
  includes3rdpartyDetails: DS.attr('string'),
  sendsDataToMicrosoft: DS.attr('string'),
  includesModernUI: DS.attr('string'),
  modernUIDetails: DS.attr('string'),
  smallProject: DS.attr('string'),

  validations: {
    publicOpenSource: {
      custom: {
        validation: (key, value) => {
          return !Ember.isEmpty(value);
        },
        message: 'must be selected'
      }
    },
    policyExemptionJustification: {
      custom: {
        validation: (key, value, model) => {
          return (model.get('publicOpenSource') === 'No' && Ember.isEmpty(value)) ? false : true;
        },
        message: 'must be selected'
      }
    },
    confirmedPolicyException: {
      custom: {
        validation: (key, value, model) => {
          return (model.get('publicOpenSource') === 'No' && !Ember.isEmpty(model.get('policyExemptionJustification')) && !value) ? false : true;
        },
        message: 'must be selected'
      }
    },
    projectType: {
      custom: {
        validation: (key, value) => {
          return !Ember.isEmpty(value);
        },
        message: 'must be selected'
      }
    },
    projectName: {
      presence: true,
      length: { maximum: 100 }
    },
    projectVersion: {
      presence: true,
      length: { maximum: 100 }
    },
    projectDescription: {
      presence: true,
      length: { maximum: 1000 }
    },
    businessGoals: {
      presence: true,
      length: { maximum: 1000 }
    },
    usage: {
      length: { maximum: 200 }
    },
    hosting: {
      custom: {
        validation: (key, value) => {
          return !Ember.isEmpty(value);
        },
        message: 'must be selected'
      }
    },
    license: {
      custom: {
        validation: (key, value) => {
          return !Ember.isEmpty(value);
        },
        message: 'must be selected'
      }
    },
    technologyArea: {
      custom: {
        validation: (key, value, model) => {
          return (model.get('license') === 'Other' && Ember.isEmpty(value)) ? false : true;
        },
        message: 'must be selected'
      }
    },
    naturalUI: {
      custom: {
        validation: (key, value, model) => {
          return (model.get('license') === 'Other' && Ember.isEmpty(value)) ? false : true;
        },
        message: 'must be selected'
      }
    },
    naturalUIDetails: {
      custom: {
        validation: (key, value, model) => {
          return (model.get('naturalUI') === 'Yes' && (Ember.isEmpty(value) || value.length > 1000)) ? false : true;
        },
        message: 'can\'t be blank or exceed 1000 characters'
      }
    },
    multimediaCodecs: {
      custom: {
        validation: (key, value, model) => {
          return (model.get('license') === 'Other' && Ember.isEmpty(value)) ? false : true;
        },
        message: 'must be selected'
      }
    },
    multimediaCodecDetails: {
      custom: {
        validation: (key, value, model) => {
          return (model.get('multimediaCodecs') === 'Yes' && (Ember.isEmpty(value) || value.length > 1000)) ? false : true;
        },
        message: 'can\'t be blank or exceed 1000 characters'
      }
    },
    backendSearch: {
      custom: {
        validation: (key, value, model) => {
          return (model.get('license') === 'Other' && Ember.isEmpty(value)) ? false : true;
        },
        message: 'must be selected'
      }
    },
    backendSearchDetails: {
      custom: {
        validation: (key, value, model) => {
          return (model.get('backendSearch') === 'Yes' && (Ember.isEmpty(value) || value.length > 1000)) ? false : true;
        },
        message: 'can\'t be blank or exceed 1000 characters'
      }
    },
    connectivityProtocols: {
      custom: {
        validation: (key, value, model) => {
          return (model.get('license') === 'Other' && Ember.isEmpty(value)) ? false : true;
        },
        message: 'must be selected'
      }
    },
    protocolDetails: {
      custom: {
        validation: (key, value, model) => {
          return (model.get('connectivityProtocols') === 'Yes' && (Ember.isEmpty(value) || value.length > 1000)) ? false : true;
        },
        message: 'can\'t be blank or exceed 1000 characters'
      }
    },
    includes3rdparty: {
      custom: {
        validation: (key, value) => {
          return !Ember.isEmpty(value);
        },
        message: 'must be selected'
      }
    },
    includes3rdpartyDetails: {
      custom: {
        validation: (key, value, model) => {
          return (model.get('includes3rdparty') === 'Yes' && (Ember.isEmpty(value) || value.length > 1000)) ? false : true;
        },
        message: 'can\'t be blank or exceed 1000 characters'
      }
    },
    sendsDataToMicrosoft: {
      custom: {
        validation: (key, value) => {
          return !Ember.isEmpty(value);
        },
        message: 'must be selected'
      }
    },
    includesModernUI: {
      custom: {
        validation: (key, value) => {
          return !Ember.isEmpty(value);
        },
        message: 'must be selected'
      }
    },
    modernUIDetails: {
      custom: {
        validation: (key, value, model) => {
          return (model.get('includesModernUI') === 'Yes' && (Ember.isEmpty(value) || value.length > 1000)) ? false : true;
        },
        message: 'can\'t be blank or exceed 1000 characters'
      }
    },
    smallProject: {
      custom: {
        validation: (key, value, model) => {
          if (['sample code', 'documentation', 'utility library / tool'].includes(model.get('projectType')) &&
            model.get('license') === 'MIT' && model.get('includes3rdparty') === 'No' && model.get('sendsDataToMicrosoft') === 'No') {
            return !Ember.isEmpty(value);
          }
          return true;
        },
        message: 'must be selected'
      }
    }
  }
});
