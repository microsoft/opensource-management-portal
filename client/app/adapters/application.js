import DS from 'ember-data';

export default DS.RESTAdapter.extend({
  namespace: 'api/client/newRepo/org/' + (window.location.pathname.split('/')[1] || 'ContosoDev'),
  normalizeErrorResponse(status, headers, payload) {
    if (payload && typeof payload === 'object' && payload.errors) {
      return payload.errors;
    } else {
      // Start change
      if (payload && payload.message) {
        payload = payload.message + ' ' + payload.correlationId;
      }
      // End change
      return [
        {
          status: `${status}`,
          title: 'The backend responded with an error',
          detail: `${payload}`
        }
      ];
    }
  }
});
