import Ember from 'ember';
import config from './config/environment';

const Router = Ember.Router.extend({
  location: config.locationType,
  rootURL: config.rootURL
});

Router.map(function() {
  this.route('new-repo', function() {
    this.route('new-approval');
    this.route('existing-approval');
    this.route('legal');
    this.route('basics');
    this.route('admin');
    this.route('write');
    this.route('read');
    this.route('contents');
    this.route('review');
    this.route('congrats');
  });
  this.route('new-approval');
  this.route('new-approval-confirmation');
});

export default Router;
