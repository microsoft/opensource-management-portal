import Ember from 'ember';

export function capitalizeFirstLetter([str]) {
  if (!str) {
    return '';
  }
  return Ember.String.capitalize(str);
}

export default Ember.Helper.helper(capitalizeFirstLetter);
