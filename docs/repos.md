# GitHub repo things

## new repo templates

When a new repository is created, a template directory can be used to
pre-populate that repo with any important files such as a standard LICENSE
file, README, contribution information, issue templates for GitHub, etc.

See also: `config/github.templates.js` which exports information from
a template data JSON file, as well as determines where those templates
live on the file system.

The original location for templates was within the same repo in the
`data/templates` folder; however, you can also use a public or private
NPM package that contains the template content.
