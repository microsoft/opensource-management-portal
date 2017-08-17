# job: everyMinute

This is a very simple job designed to help validate connecting jobs for this
service to a k8s cluster or similar system.

Designed to be run every single minute while validating, the job simply does
a resolution of the configuration, and then outputs the configuration.

Be forewarned that the output will contain any secrets that have been resolved
from vaults.
