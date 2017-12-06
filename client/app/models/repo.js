import DS from 'ember-data';
import Ember from 'ember';
import Validator from '../mixins/model-validator';

export default DS.Model.extend(Validator, {
  name: DS.attr('string'),
  projectType: DS.attr('string'),
  description: DS.attr('string'),
  visibility: DS.attr('string'),
  approvalType: DS.attr('string', { defaultValue: 'New release registration' }),
  justification: DS.attr('string'),
  approvalUrl: DS.attr('string'),
  legalEntity: DS.attr('string', { defaultValue: 'Microsoft' }),
  legalEmails: DS.attr('string', { defaultValue: '' }),
  license: DS.attr('string', { defaultValue: 'mit' }),
  preSelectedLicense: DS.attr('string'),
  gitIgnoreLanguage: DS.attr('string'),
  selectedPersonalizedAdminTeams: DS.attr('raw'),
  selectedPersonalizedWriteTeams: DS.attr('raw'),
  selectedPersonalizedReadTeams: DS.attr('raw'),
  selectedAdminTeams: DS.attr('raw'),
  selectedWriteTeams: DS.attr('raw'),
  selectedReadTeams: DS.attr('raw'),

  validations: {
    name: {
      presence: true,
      length: { maximum: 1024 }
    },
    description: {
      presence: true
    },
    approvalUrl: {
      custom: {
        validation: (key, value) => {
          return Ember.isEmpty(value) ? false : true;
        },
        message: 'must be selected'
      }
    },
    legalEmails: {
      format: { with: /^([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*,{0,1}\s*)*$/, message: 'must be a comma-separated list of emails' }
    }
  }
});
