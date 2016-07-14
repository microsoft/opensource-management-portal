//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

module.exports = function configurePassport(app, passport) {
    // ----------------------------------------------------------------------------
    // passport integration with GitHub
    // ----------------------------------------------------------------------------
    app.get('/signin/github', function (req, res) {
        if (req.session && req.headers && req.headers.referer) {
            req.session.referer = req.headers.referer;
        }
        return res.redirect('/auth/github');
    });

    app.get('/auth/github',
        passport.authenticate('github'),
        function (req, res){
            // The request will be redirected to GitHub for authentication, so this
            // function will not be called.
        });

    app.get('/auth/github/callback',
        passport.authenticate('github', { failureRedirect: '/failure/github' }),
        function (req, res) {
            var url = '/';
            if (req.session && req.session.referer) {
                url = req.session.referer;
                delete req.session.referer;
            }
            res.redirect(url);
        });

    app.get('/signout', function (req, res) {
        req.logout();
        res.redirect('https://github.com/logout');
    });

    // ----------------------------------------------------------------------------
    // Expanded GitHub auth scope routes
    // ----------------------------------------------------------------------------
    app.get('/signin/github/increased-scope', function (req, res){
        if (req.session && req.headers && req.headers.referer) {
            req.session.referer = req.headers.referer;
        }
        return res.redirect('/auth/github/increased-scope');
    });

    app.get('/auth/github/increased-scope', passport.authorize('expanded-github-scope'));

    app.get('/auth/github/callback/increased-scope',
        passport.authorize('expanded-github-scope'), function (req, res, next) {
            var account = req.account;
            var user = req.user;
            user.github.increasedScope = account;
            var url = '/';
            if (req.session && req.session.referer) {
                url = req.session.referer;
                delete req.session.referer;
            }
            res.redirect(url);
        });

    // ----------------------------------------------------------------------------
    // passport integration with Azure Active Directory
    // ----------------------------------------------------------------------------
    app.get('/auth/azure', passport.authorize('azure-active-directory'));

    app.post('/auth/azure/callback',
        passport.authorize('azure-active-directory'), function (req, res, next) {
            var account = req.account;
            var username = account._json.upn;
            if (account !== null && username && account.displayName) {
                req.user.azure = {
                    displayName: account.displayName,
                    oid: account._json.oid,
                    username: username,
                };
                var url = '/';
                if (req.session && req.session.referer) {
                    url = req.session.referer;
                    delete req.session.referer;
                }
                return res.redirect(url);
          } else {
              return next(new Error('Azure Active Directory authentication failed.'));
          }
      });

    app.get('/signin/azure', function(req, res){
        if (req.session && req.headers && req.headers.referer) {
            if (req.session.referer === undefined) {
                req.session.referer = req.headers.referer;
            }
        }
        return res.redirect('/auth/azure');
    });

    app.get('/signout/azure', function(req, res){
        if (req.user && req.user.azure) {
            delete req.user.azure;
        }
        res.redirect('/');
    });
};
