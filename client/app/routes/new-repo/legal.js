import Ember from 'ember';
import RSVP from 'rsvp';

export default Ember.Route.extend({
  model() {
    return RSVP.hash({
      repo: this.store.findRecord('repo', 1),
      metadata: this.store.findAll('metadatum').then(metadata => metadata.objectAt(0))
    });
  },
  setupController(controller, model) {
    this._super(...arguments);
    const preselectedLegalEntity = model.repo.get('legalEntity');
    if (!preselectedLegalEntity || !model.metadata.get('legalEntities').includes(preselectedLegalEntity)) {
      model.repo.set('legalEntity', model.metadata.get('legalEntities')[0]);
      model.repo.save();
    }
  },
  actions: {
    selectEntity(selection) {
      this.currentModel.repo.set('legalEntity', selection);
      this.currentModel.repo.save();
    },
    next(repo) {
      const emails = repo.get('legalEmails');
      if (Ember.isBlank(emails) || (!Ember.isBlank(emails) && repo.validate({ only: ['legalEmails'] }))) {
        repo.set('legalEmails', emails.replace(/\s/g, ''));
        repo.save();
        this.transitionTo('new-repo.contents');
      }
    }
  }
});
