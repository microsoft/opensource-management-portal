import DS from 'ember-data';

export default DS.Model.extend({
  title: DS.attr('string'),
  state: DS.attr('string'),
  url: DS.attr('string'),
  license: DS.attr('string')
});
