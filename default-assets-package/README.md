# @ospo/site-assets

> Microsoft internal repo

The purpose of this repo is to store assets such as the Microsoft logo,
stylesheets, etc. used by the `repos.opensource.microsoft.com` internal
site.

These assets being a private NPM package that ships with the site will
make it easier to share and open source more of the app with less manual
work, and also improve build times for the site itself by pulling out
grunt, style generation and copy tasks, then shipping these assets inside
the private NPM package.

While an equivalent/similar repo may go open source to contain generic
icons or themes, the NPM package this generates and this repo's graphics
and styles are not destined for that path.
