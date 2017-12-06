import Ember from 'ember';
import RSVP from 'rsvp';

export default Ember.Route.extend({
  util: Ember.inject.service(),
  model() {
    return RSVP.hash({
      repo: this.store.findRecord('repo', 1),
      metadata: this.store.findAll('metadatum').then(metadata => metadata.objectAt(0))
    });
  },
  setupController(controller) {
    this._super(...arguments);
    Ember.set(controller, 'orgName', this.get('util').getOrgName());
  }
});
