# Health checks

To help improve the experience of worldwide deployment and make load balancers happy, there are
configuration values that can be used to allow for endpoint probes.

As of October 2022, _no health probes are exposed by default_, but they're easy enough to opt-in.

The file `./middleware/healthCheck.ts` implements these currently. You can allow as many types of
checks you like. The first check type that "matches" will be sent a generic HTTP 200 response (consider
always just using `HEAD` to save on bandwidth), or a HTTP 500.

General probe configuration:

- `ENABLE_WEB_HEALTH_PROBES`: '1' by default - ready to provide probes, but no-op without any allowed probes
- `WEB_HEALTH_LIVENESS_DELAY`: initial delay at startup before attempting to expose liveness, defaults to 5 seconds
- `WEB_HEALTH_READINESS_DELAY`: initial delay at startup before exposing readiness, defaults to 10 seconds

"External" un-gated probe:

_Expose an endpoint to any user, no check for headers, at `/health/[endpoint suffix]`_

- `EXTERNAL_HEALTH_PROBES`: '1' to enable
- `EXTERNAL_HEALTH_PROBE_ENDPOINT_SUFFIX`: suffix added for the checkname; defaults to `external` to expose `/health/external`

Kubernetes pod health checks:

- `KUBERNETES_HEALTH_PROBES`: '1' to enable
- `KUBERNETES_HEALTH_CHECK_KEY`: header to check, default is `x-health-check` that our team uses
- `KUBERNETES_HEALTH_CHECK_VALUE`: header value to check, default is `check` that our team uses

Azure Front Door check:

- `AZURE_FRONTDOOR_HEALTH_PROBES`: set to '1' to expose `/health/liveness` and `/health/readiness` probes for Front Door
- AFD is gated on the `user-agent` "Edge Health Probe". `AZURE_FRONTDOOR_HEALTH_CHECK_KEY` and `AZURE_FRONTDOOR_HEALTH_CHECK_VALUE` can override.
