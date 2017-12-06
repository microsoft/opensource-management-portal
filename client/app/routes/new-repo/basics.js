import Ember from 'ember';
import RSVP from 'rsvp';
import {isAjaxError, isNotFoundError, isUnauthorizedError} from 'ember-ajax/errors';

export default Ember.Route.extend({
  ajax: Ember.inject.service(),
  flashMessages: Ember.inject.service(),
  spinner: Ember.inject.service('spinner'),
  util: Ember.inject.service(),
  beforeModel() {
    let newReleaseApproval = this.store.peekRecord('new-release-approval', 1);
    if (!newReleaseApproval) {
      newReleaseApproval = this.store.createRecord('newReleaseApproval', { id: 1 });
      newReleaseApproval.save();
    }
  },
  model() {
    return RSVP.hash({
      repo: this.store.findRecord('repo', 1),
      metadata: this.store.findAll('metadatum').then(metadata => metadata.objectAt(0)),
      newReleaseApproval: this.store.findRecord('newReleaseApproval', 1)
    });
  },
  afterModel({ repo, metadata, newReleaseApproval }) {
    const visibilities = metadata.get('visibilities');
    if (!repo.get('visibility')) {
      repo.set('visibility', visibilities && visibilities.length > 0 ? visibilities[0] : 'public');
    }
    if (!newReleaseApproval.get('policyExemptionJustification')) {
      repo.set('justification', undefined);
    }
    repo.set('name', newReleaseApproval.get('projectName') || repo.get('name'));
    repo.set('projectType', newReleaseApproval.get('projectType'));
    if (newReleaseApproval.get('confirmedPolicyException')) {
      repo.set('approvalType', 'Exemption: other');
      repo.set('justification', 'Policy exception: ' + newReleaseApproval.get('policyExemptionJustification'));
    } else if (newReleaseApproval.get('smallProject') === 'Yes') {
      repo.set('approvalType', 'Exemption: small libraries, tools, and samples');
    } else if (repo.get('approvalType') === 'Exemption: other' || repo.get('approvalType') === 'Exemption: small libraries, tools, and samples') {
      repo.set('approvalType', 'New release registration');
    }
    repo.save();
  },
  setupController(controller, { metadata }) {
    this._super(...arguments);
    Ember.set(controller, 'orgName', this.get('util').getOrgName());
    const visibilities = metadata.get('visibilities');
    if (visibilities && visibilities.length > 1) {
      Ember.set(controller, 'hasMultipleVisibilities', true);
    }
  },
  actions: {
    back(repo) {
      const approvalType = repo.get('approvalType') || '';
      if (approvalType.toLowerCase().includes('existing release')) {
        return this.transitionTo('new-repo.existing-approval');
      }
      if (approvalType.toLowerCase().includes('codeplex')) {
        return this.transitionTo('new-repo');
      }
      this.transitionTo('new-repo.new-approval');
    },
    next(repo) {
      if (repo.validate({ only: ['name', 'description'] })) {
        const name = repo.get('name');
        const orgName = this.get('util').getOrgName();
        repo.save();
        this.get('spinner').show('1');
        return this.get('ajax').request(`/api/client/newRepo/org/${orgName}/repo/${name}`)
          .then(() => {
            Ember.get(this, 'flashMessages').danger(`${name} repo already exists under ${orgName} organization. Please change repo name.`);
          }).catch(error => {
            if (isNotFoundError(error)) {
              return this.transitionTo('new-repo.admin');
            }
            if (isUnauthorizedError(error)) {
              return Ember.get(this, 'flashMessages').danger('Unauthorized.');
            }
            if (isAjaxError(error)) {
              return Ember.get(this, 'flashMessages').danger('Unexpected error occurred.');
            }
          }).finally(() => {
            this.get('spinner').hide('1');
          });
      }
    },
    validateName() {
      this.currentModel.repo.validate({ only: ['name'] });
    },
    validateDescription() {
      this.currentModel.repo.validate({ only: ['name', 'description'] });
    }
  }
});
