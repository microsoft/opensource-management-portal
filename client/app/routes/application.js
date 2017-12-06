import Ember from 'ember';

export default Ember.Route.extend({
  flashMessages: Ember.inject.service(),
  spinner: Ember.inject.service('spinner'),
  actions: {
    loading(transition) {
      this.get('spinner').show('1');
      transition.promise.finally(() => {
        this.get('spinner').hide('1');
      });
    },
    error(error) {
      Ember.debug(error);
      Ember.get(this, 'flashMessages').danger(error.errors && error.errors[0] ? error.errors[0].detail : 'Unexpected error occurred.');
      this.replaceWith('index');
    }
  }
});
