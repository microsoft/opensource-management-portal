/* global describe, it, before, expect */
/* jshint expr: true */

var GitHubStrategy = require('../lib/strategy');


describe('Strategy#userProfile', function() {
    
  describe('fetched from default endpoint', function() {
    var strategy =  new GitHubStrategy({
      clientID: 'ABC123',
      clientSecret: 'secret'
    }, function() {});
  
    strategy._oauth2.get = function(url, accessToken, callback) {
      if (url != 'https://api.github.com/user') { return callback(new Error('wrong url argument')); }
      if (accessToken != 'token') { return callback(new Error('wrong token argument')); }
    
      var body = '{ "login": "octocat", "id": 1, "name": "monalisa octocat", "email": "octocat@github.com", "html_url": "https://github.com/octocat" }';
      callback(null, body, undefined);
    };
    
    
    var profile;
    
    before(function(done) {
      strategy.userProfile('token', function(err, p) {
        if (err) { return done(err); }
        profile = p;
        done();
      });
    });
    
    it('should parse profile', function() {
      expect(profile.provider).to.equal('github');
      
      expect(profile.id).to.equal('1');
      expect(profile.username).to.equal('octocat');
      expect(profile.displayName).to.equal('monalisa octocat');
      expect(profile.profileUrl).to.equal('https://github.com/octocat');
      expect(profile.emails).to.have.length(1);
      expect(profile.emails[0].value).to.equal('octocat@github.com');
    });
    
    it('should set raw property', function() {
      expect(profile._raw).to.be.a('string');
    });
    
    it('should set json property', function() {
      expect(profile._json).to.be.an('object');
    });
  }); // fetched from default endpoint
  
  describe('fetched from default endpoint and then fetching emails, where user has a publicly visible email address', function() {
    var strategy =  new GitHubStrategy({
      clientID: 'ABC123',
      clientSecret: 'secret',
      scope: [ 'user:email' ]
    }, function() {});
  
    strategy._oauth2._request = function(method, url, headers, body, accessToken, callback) {
      var body;
      switch (url) {
      case 'https://api.github.com/user':
        body = '{ "login": "octocat", "id": 1, "name": "monalisa octocat", "email": "octocat@github.com", "html_url": "https://github.com/octocat" }';
        break;
      case 'https://api.github.com/user/emails':
        body = '[{"email":"octocat@github.com","primary":true,"verified":true}]';
        break;
      default:
        return callback(new Error('wrong url argument'));
      }
      callback(null, body, undefined);
    };
    
    
    var profile;
    
    before(function(done) {
      strategy.userProfile('token', function(err, p) {
        if (err) { return done(err); }
        profile = p;
        done();
      });
    });
    
    it('should parse profile', function() {
      expect(profile.provider).to.equal('github');
      
      expect(profile.id).to.equal('1');
      expect(profile.username).to.equal('octocat');
      expect(profile.displayName).to.equal('monalisa octocat');
      expect(profile.profileUrl).to.equal('https://github.com/octocat');
      expect(profile.emails).to.have.length(1);
      expect(profile.emails[0].value).to.equal('octocat@github.com');
      expect(profile.emails[0].primary).to.equal(true);
      expect(profile.emails[0].verified).to.equal(true);
    });
    
    it('should set raw property', function() {
      expect(profile._raw).to.be.a('string');
    });
    
    it('should set json property', function() {
      expect(profile._json).to.be.an('object');
    });
  }); // fetched from default endpoint and then fetching emails, where user has a publicly visible email address
  
  describe('fetched from default endpoint and then fetching emails, where user does not have a publicly visible email address', function() {
    var strategy =  new GitHubStrategy({
      clientID: 'ABC123',
      clientSecret: 'secret',
      scope: [ 'user:email' ]
    }, function() {});
  
    strategy._oauth2._request = function(method, url, headers, body, accessToken, callback) {
      var body;
      switch (url) {
      case 'https://api.github.com/user':
        body = '{ "login": "octocat", "id": 1, "name": "monalisa octocat", "html_url": "https://github.com/octocat" }';
        break;
      case 'https://api.github.com/user/emails':
        body = '[{"email":"octocat@github.com","primary":true,"verified":true}]';
        break;
      default:
        return callback(new Error('wrong url argument'));
      }
      callback(null, body, undefined);
    };
    
    
    var profile;
    
    before(function(done) {
      strategy.userProfile('token', function(err, p) {
        if (err) { return done(err); }
        profile = p;
        done();
      });
    });
    
    it('should parse profile', function() {
      expect(profile.provider).to.equal('github');
      
      expect(profile.id).to.equal('1');
      expect(profile.username).to.equal('octocat');
      expect(profile.displayName).to.equal('monalisa octocat');
      expect(profile.profileUrl).to.equal('https://github.com/octocat');
      expect(profile.emails).to.have.length(1);
      expect(profile.emails[0].value).to.equal('octocat@github.com');
      expect(profile.emails[0].primary).to.equal(true);
      expect(profile.emails[0].verified).to.equal(true);
    });
    
    it('should set raw property', function() {
      expect(profile._raw).to.be.a('string');
    });
    
    it('should set json property', function() {
      expect(profile._json).to.be.an('object');
    });
  }); // fetched from default endpoint and then fetching emails, where user does not have a publicly visible email address
  
  describe('fetched from default endpoint and then fetching emails, where user does not have any publicly visible or privately available email addresses', function() {
    var strategy =  new GitHubStrategy({
      clientID: 'ABC123',
      clientSecret: 'secret',
      scope: [ 'user:email' ]
    }, function() {});
  
    strategy._oauth2._request = function(method, url, headers, body, accessToken, callback) {
      var body;
      switch (url) {
      case 'https://api.github.com/user':
        body = '{ "login": "octocat", "id": 1, "name": "monalisa octocat", "html_url": "https://github.com/octocat" }';
        break;
      case 'https://api.github.com/user/emails':
        body = '[]';
        break;
      default:
        return callback(new Error('wrong url argument'));
      }
      callback(null, body, undefined);
    };
    
    
    var profile;
    
    before(function(done) {
      strategy.userProfile('token', function(err, p) {
        if (err) { return done(err); }
        profile = p;
        done();
      });
    });
    
    it('should parse profile', function() {
      expect(profile.provider).to.equal('github');
      
      expect(profile.id).to.equal('1');
      expect(profile.username).to.equal('octocat');
      expect(profile.displayName).to.equal('monalisa octocat');
      expect(profile.profileUrl).to.equal('https://github.com/octocat');
      expect(profile.emails).to.be.undefined;
    });
    
    it('should set raw property', function() {
      expect(profile._raw).to.be.a('string');
    });
    
    it('should set json property', function() {
      expect(profile._json).to.be.an('object');
    });
  }); // fetched from default endpoint and then fetching emails, where user does not have any publicly visible or privately available email addresses
  
  describe('fetched from default endpoint and then fetching emails, where user has a publicly visible email address but user:email scope has not been granted', function() {
    var strategy =  new GitHubStrategy({
      clientID: 'ABC123',
      clientSecret: 'secret',
      scope: [ 'user:email' ]
    }, function() {});
  
    strategy._oauth2._request = function(method, url, headers, body, accessToken, callback) {
      var body;
      switch (url) {
      case 'https://api.github.com/user':
        body = '{ "login": "octocat", "id": 1, "name": "monalisa octocat", "email": "octocat@github.com", "html_url": "https://github.com/octocat" }';
        break;
      case 'https://api.github.com/user/emails':
        return callback({ statusCode: 404,
                          data: '{"message":"Not Found","documentation_url":"https://developer.github.com/v3"}' });
      default:
        return callback(new Error('wrong url argument'));
      }
      callback(null, body, undefined);
    };
    
    
    var profile;
    
    before(function(done) {
      strategy.userProfile('token', function(err, p) {
        if (err) { return done(err); }
        profile = p;
        done();
      });
    });
    
    it('should parse profile', function() {
      expect(profile.provider).to.equal('github');
      
      expect(profile.id).to.equal('1');
      expect(profile.username).to.equal('octocat');
      expect(profile.displayName).to.equal('monalisa octocat');
      expect(profile.profileUrl).to.equal('https://github.com/octocat');
      expect(profile.emails).to.have.length(1);
      expect(profile.emails[0].value).to.equal('octocat@github.com');
      expect(profile.emails[0].primary).to.equal(undefined);
      expect(profile.emails[0].verified).to.equal(undefined);
    });
    
    it('should set raw property', function() {
      expect(profile._raw).to.be.a('string');
    });
    
    it('should set json property', function() {
      expect(profile._json).to.be.an('object');
    });
  }); // fetched from default endpoint and then fetching emails, where user has a publicly visible email address but user:email scope has not been granted
  
  describe('fetched from default endpoint and then fetching emails, where user has a publicly visible email address but emails response is malformed', function() {
    var strategy =  new GitHubStrategy({
      clientID: 'ABC123',
      clientSecret: 'secret',
      scope: [ 'user:email' ]
    }, function() {});
  
    strategy._oauth2._request = function(method, url, headers, body, accessToken, callback) {
      var body;
      switch (url) {
      case 'https://api.github.com/user':
        body = '{ "login": "octocat", "id": 1, "name": "monalisa octocat", "email": "octocat@github.com", "html_url": "https://github.com/octocat" }';
        break;
      case 'https://api.github.com/user/emails':
        body = 'Hello, world.';
        break;
      default:
        return callback(new Error('wrong url argument'));
      }
      callback(null, body, undefined);
    };
    
    
    var profile;
    
    before(function(done) {
      strategy.userProfile('token', function(err, p) {
        if (err) { return done(err); }
        profile = p;
        done();
      });
    });
    
    it('should parse profile', function() {
      expect(profile.provider).to.equal('github');
      
      expect(profile.id).to.equal('1');
      expect(profile.username).to.equal('octocat');
      expect(profile.displayName).to.equal('monalisa octocat');
      expect(profile.profileUrl).to.equal('https://github.com/octocat');
      expect(profile.emails).to.have.length(1);
      expect(profile.emails[0].value).to.equal('octocat@github.com');
      expect(profile.emails[0].primary).to.equal(undefined);
      expect(profile.emails[0].verified).to.equal(undefined);
    });
    
    it('should set raw property', function() {
      expect(profile._raw).to.be.a('string');
    });
    
    it('should set json property', function() {
      expect(profile._json).to.be.an('object');
    });
  }); // fetched from default endpoint and then fetching emails, where user has a publicly visible email address but emails response is malformed
  
  describe('fetched from custom endpoint', function() {
    var strategy =  new GitHubStrategy({
      clientID: 'ABC123',
      clientSecret: 'secret',
      userProfileURL: 'https://github.corpDomain/api/v3/user'
    }, function() {});
  
    strategy._oauth2.get = function(url, accessToken, callback) {
      if (url != 'https://github.corpDomain/api/v3/user') { return callback(new Error('wrong url argument')); }
      if (accessToken != 'token') { return callback(new Error('wrong token argument')); }
    
      var body = '{ "login": "octocat", "id": 1, "name": "monalisa octocat", "email": "octocat@github.com", "html_url": "https://github.com/octocat" }';
      callback(null, body, undefined);
    };
    
    
    var profile;
    
    before(function(done) {
      strategy.userProfile('token', function(err, p) {
        if (err) { return done(err); }
        profile = p;
        done();
      });
    });
    
    it('should parse profile', function() {
      expect(profile.provider).to.equal('github');
      
      expect(profile.id).to.equal('1');
      expect(profile.username).to.equal('octocat');
      expect(profile.displayName).to.equal('monalisa octocat');
      expect(profile.profileUrl).to.equal('https://github.com/octocat');
      expect(profile.emails).to.have.length(1);
      expect(profile.emails[0].value).to.equal('octocat@github.com');
    });
    
    it('should set raw property', function() {
      expect(profile._raw).to.be.a('string');
    });
    
    it('should set json property', function() {
      expect(profile._json).to.be.an('object');
    });
  });
  
  describe('error caused by invalid token', function() {
    var strategy =  new GitHubStrategy({
        clientID: 'ABC123',
        clientSecret: 'secret'
      }, function() {});
  
    strategy._oauth2.get = function(url, accessToken, callback) {
      var body = '{"message":"Bad credentials","documentation_url":"https://developer.github.com/v3"}';
      callback({ statusCode: 400, data: body });
    };
      
    var err, profile;
    before(function(done) {
      strategy.userProfile('token', function(e, p) {
        err = e;
        profile = p;
        done();
      });
    });
  
    it('should error', function() {
      expect(err).to.be.an.instanceOf(Error);
      expect(err.constructor.name).to.equal('APIError');
      expect(err.message).to.equal('Bad credentials');
    });
  }); // error caused by invalid token
  
  describe('error caused by malformed response', function() {
    var strategy =  new GitHubStrategy({
        clientID: 'ABC123',
        clientSecret: 'secret'
      }, function() {});
  
    strategy._oauth2.get = function(url, accessToken, callback) {
      var body = 'Hello, world.';
      callback(null, body, undefined);
    };
      
    var err, profile;
    before(function(done) {
      strategy.userProfile('token', function(e, p) {
        err = e;
        profile = p;
        done();
      });
    });
  
    it('should error', function() {
      expect(err).to.be.an.instanceOf(Error);
      expect(err.message).to.equal('Failed to parse user profile');
    });
  }); // error caused by malformed response
  
  describe('internal error', function() {
    var strategy =  new GitHubStrategy({
      clientID: 'ABC123',
      clientSecret: 'secret'
    }, function() {});
  
    strategy._oauth2.get = function(url, accessToken, callback) {
      return callback(new Error('something went wrong'));
    }
    
    
    var err, profile;
    
    before(function(done) {
      strategy.userProfile('wrong-token', function(e, p) {
        err = e;
        profile = p;
        done();
      });
    });
    
    it('should error', function() {
      expect(err).to.be.an.instanceOf(Error);
      expect(err.constructor.name).to.equal('InternalOAuthError');
      expect(err.message).to.equal('Failed to fetch user profile');
      expect(err.oauthError).to.be.an.instanceOf(Error);
      expect(err.oauthError.message).to.equal('something went wrong');
    });
    
    it('should not load profile', function() {
      expect(profile).to.be.undefined;
    });
  }); // internal error
  
});
