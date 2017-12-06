import Ember from 'ember';

export default Ember.Route.extend({
  beforeModel() {
    if (window.location.pathname.split('/').filter(entry => entry)[0] === 'releases') {
      return this.transitionTo('new-approval');
    }
    this.transitionTo('new-repo');
  }
});
