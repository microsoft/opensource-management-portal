# azure-oss-portal

The Azure Open Source Portal for GitHub is the culmination of years of trying to manage the 
Azure presence on GitHub through a lot of trial, error, and improvement in tooling.

Starting as a hackathon, today it is used to manage a number of organizations on GitHub at 
an enterprise-grade scale by automating organization onboarding and delegating management 
decisions to team maintainers.

> A ton of information is available right now in this post in lieu of other README content  [http://www.jeff.wilcox.name/2015/11/azure-on-github/](http://www.jeff.wilcox.name/2015/11/azure-on-github/)

# Platform

- Node.js LTS+

# Service Dependencies

- Bring your own Redis server, or use Azure Redis Cache
- Azure Active Directory, or hack your own Passport provider in
- Azure Storage for table, `data.js` will need some refactoring to support other providers

Oh, and you'll need your own GitHub org.

## LICENSE

[MIT License](LICENSE)
