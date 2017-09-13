//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const expect = require('chai').expect;
const context = require('../lib/context');

describe('context', () => {
  describe('insights', () => {
    it('does not require application insights', () => {
      const options = {
        operations: 'fake operations',
      };
      new context(options, (error) => {
        expect(error).to.exist;
        expect(error).to.have.property('message', 'Could not initialize the context for the acting user.');
      });
    });
    it('mocks application insights as needed', () => {
      // Make sure we can always use insights without checking for its existance
      const options = {
        operations: 'fake operations',
      };
      new context(options, (error, instance) => {
        expect(error).to.exist;
        expect(instance).to.exist;
        expect(instance).to.have.property('insights');
        expect(instance.insights).to.have.property('trackEvent');
        expect(instance.insights.trackEvent).to.be.a('function');
      });
    });
  });
});
