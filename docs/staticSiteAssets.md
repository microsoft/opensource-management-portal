# Static Site Assets

To simplify the app build process, and also make it easier for us to open
source a lot of the project without Microsoft-specific assets and content,
the site pulls its static assets (favicon, graphics, client scripts) from
an NPM package.

Inside the app's `package.json`, a property can be set, `static-site-assets-package-name`,
pointing to the name of an NPM package (public or private) that contains those assets.

By default, this project contains a `default-assets-package` sub-folder NPM package
with more generic Bootstrap content, Grunt build scripts, etc. It is used if this variable
is not defined in the package JSON. Unfortunately you need to separately
`npm install` and `grunt` to use it, or just point it at your own set of
CSS files and other assets. Sorry, its not pretty.
