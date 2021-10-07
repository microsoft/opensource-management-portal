Starting in 2019, logic from the portal began moving out of Express-based routes (never a good
design to start with), and into helper functions and APIs.

Today, the Microsoft instance of the portal does not use the Pug site for any primary purpose,
and instead hosts a React-based front-end. Session-based APIs on the same domain are used for
operations.

JWilcox prototyped an approach as part of a hackathon and it was an effective outcome.

Conversation against:

- While some of the corporate, non-Microsoft users of the portal appreciate the
  "it just works out of the box" approach of a server-rendered Express & Pug Node app,
  the internal employee nature of the tool coupled with the need to more rapidly prototype
  and ship simple changes, including logic, was just getting very challenging.

Reasons for:

- Quicker iterative loop
- Easier to implement view logic at runtime, including company-specific routes and implementation
- Able to adopt GitHub Primer for GitHub-consistent user interface (a better hybrid visual set)
- Moves away from jQuery, Bootstrap 3, very old and probably not great building blocks

Mitigation for concerns:

For now, the site remains Pug + API-based. In the future, the Pug (server-rendered) implementation
may split into a separate sub-app, sub-module, or separate repo.

Decision maker: Microsoft OSPO
Consulted: GitHub issues and discussions on e-mail with users of the portal
