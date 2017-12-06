import Ember from 'ember';

export default Ember.Route.extend({
  beforeModel() {
    let newReleaseApproval = this.store.peekRecord('new-release-approval', 1);
    if (!newReleaseApproval) {
      newReleaseApproval = this.store.createRecord('newReleaseApproval', { id: 1 });
    }
  },
  model() {
    return this.store.findRecord('newReleaseApproval', 1);
  },
  actions: {
    next() {
      this.transitionTo('new-approval-confirmation');
    }
  }
});
