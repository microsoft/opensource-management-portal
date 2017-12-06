import DS from 'ember-data';

/**
 * Exists to facilate the use of arrays within our data-models.
 * for example:  DS.attr(raw);
 */
export default DS.Transform.extend({
  deserialize(serialized) {
    return serialized;
  },

  serialize(deserialized) {
    return deserialized;
  }
});
