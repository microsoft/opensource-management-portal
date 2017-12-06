import Ember from 'ember';
import RSVP from 'rsvp';

export default Ember.Route.extend({
  beforeModel() {
    let repo = this.store.peekRecord('repo', 1);
    if (!repo) {
      repo = this.store.createRecord('repo', { id: 1 });
      repo.save();
    }
    this.store.unloadAll('newReleaseApproval');
  },
  model() {
    return RSVP.hash({
      repo: this.store.findRecord('repo', 1),
      approvalTypes: this.get('approvalTypes')
    });
  },
  afterModel({ repo }) {
    if (!this.approvalTypes.includes(repo.get('approvalType'))) {
      repo.set('approvalType', this.approvalTypes[0]);
    }
  },
  actions: {
    next(repo) {
      const type = repo.get('approvalType');
      repo.set('license', undefined);
      repo.set('preSelectedLicense', undefined);
      if (type.toLowerCase().includes('new release')) {
        repo.set('approvalUrl', undefined);
        repo.save();
        return this.transitionTo('new-repo.new-approval');
      }
      if (type.toLowerCase().includes('existing release')) {
        this.transitionTo('new-repo.existing-approval');
      }
      if (type.toLowerCase().includes('codeplex')) {
        repo.set('approvalUrl', undefined);
        repo.save();
        return this.transitionTo('new-repo.basics');
      }
    },
  },
  approvalTypes: ['New release registration', 'Existing release review', 'Migrate project from CodePlex']
});
