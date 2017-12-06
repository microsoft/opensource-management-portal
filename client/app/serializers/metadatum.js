import ApplicationSerializer from './application';

export default ApplicationSerializer.extend({
  normalizeResponse(store, primaryModelClass, payload, id, requestType) {
    let normalizedPayload = {
      metadata: payload
    };
    normalizedPayload.metadata.id = 1;
    return this._super(store, primaryModelClass, normalizedPayload, id, requestType);
  }
});