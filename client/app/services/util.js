import Ember from 'ember';

export default Ember.Service.extend({
  getOrgName() {
    return window.location.pathname.split('/').filter(entry => entry)[0] || 'ContosoDev';
  }
});
