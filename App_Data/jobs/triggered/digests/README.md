# digests job

This job generates a consolidated report across all configured GitHub organizations
every few hours.

> The initial cron schedule is `0 5 0,4,10,16,22 * * *`. This is designed to help _prime the reports_ that are stored.

This is to help keep data up-to-date and also to try and have a good report ready by 6:00 UTC daily.

__WARNING:__ If you configure your environment to send reports, this cron frequency needs to change. Right now it would send whenever the reports are generated, which would be multiple times per day, etc.!

The job outputs in a few days:

- A Redis key storing a compressed, consolidated report JSON object
- An optional consolidated report JSON file
- Optionally sends e-mails to individual recipients using the ospo-opensource-repos provider for mail
- Optionally stores e-mails as rendered HTML snippet files instead of e-mails
- Optional Azure storage blob create designed to then be ingested into Azure Data Lake