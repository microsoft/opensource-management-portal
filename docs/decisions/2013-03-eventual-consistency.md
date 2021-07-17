A majority of the user interface within the management portal is _eventually consistent_ and not
necessarily an accurate real-time view.

All **decisions** about permissions validate real-time permissions with the GitHub API; however,
all views are going to be eventual instead.

By keeping a long-standing cache of entities, the app can better respect the Conditional Request aspect
of the GitHub v3 API.
