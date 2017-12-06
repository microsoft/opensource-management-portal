import DS from 'ember-data';

export default DS.Model.extend({
  approval: DS.attr('raw'),
  legalEntities: DS.attr('raw'),
  gitIgnore: DS.attr('raw'),
  supportsCla: DS.attr('boolean', { defaultValue: false }),
  templates: DS.attr('raw'),
  visibilities: DS.attr('raw')
});
