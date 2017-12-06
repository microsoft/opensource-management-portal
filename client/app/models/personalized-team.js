import DS from 'ember-data';

export default DS.Model.extend({
  name: DS.attr('string'),
  description: DS.attr('string'),
  role: DS.attr('string'),
  broad: DS.attr('boolean')
});
