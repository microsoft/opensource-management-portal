import Ember from 'ember';
import RSVP from 'rsvp';

export default Ember.Route.extend({
  model() {
    return RSVP.hash({
      repo: this.store.findRecord('repo', 1),
      releaseApprovals: this.store.findAll('release-approval')
    });
  },
  setupController(controller, model) {
    this._super(...arguments);
    Ember.set(controller, 'releaseApprovals', model.releaseApprovals);
  },
  actions: {
    next({ repo }) {
      if (repo.validate({ only: ['approvalUrl'] })) {
        repo.save();
        this.transitionTo('new-repo.basics');
      }
    },
    selectEntity(approval) {
      this.controller.set('approval', approval);
      this.currentModel.repo.set('approvalUrl', approval ? approval.get('url') : undefined);
      const license = approval.get('license');
      this.currentModel.repo.set('preSelectedLicense', license.toLowerCase());
    }
  }
});
