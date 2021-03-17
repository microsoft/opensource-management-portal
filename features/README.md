# Features

There was an early thinking that "features" would provide feature-flag, independently-implemented 
capabilities or sub-applications.

I don't think the design has really panned out. Open to feedback here.

## Organization sudo

> This feature is enabled by default but only lights up when orgs are configured for it.

Allows a set of users to have elevated privileges when using the portal. Helpful for 
helping support a large organization with a set of trusted users configured at the organization 
level to reduce persistent owner permissions.

[Review the sudo feature docs](sudo/sudo.md)
