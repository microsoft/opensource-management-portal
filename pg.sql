BEGIN;

CREATE TABLE IF NOT EXISTS settings (
	usertype text,
	userid text,
	settings jsonb,
	PRIMARY KEY(usertype, userid)
);

CREATE TABLE IF NOT EXISTS auditlog (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);

CREATE INDEX IF NOT EXISTS auditlog_teamid ON auditlog ((metadata->>'teamid'));
CREATE INDEX IF NOT EXISTS auditlog_repoid ON auditlog ((metadata->>'repositoryid'));
CREATE INDEX IF NOT EXISTS auditlog_orgid ON auditlog ((metadata->>'organizationid'));
CREATE INDEX IF NOT EXISTS auditlog_actorid ON auditlog ((metadata->>'actorid'));
CREATE INDEX IF NOT EXISTS auditlog_userid ON auditlog ((metadata->>'userid'));
CREATE INDEX IF NOT EXISTS auditlog_gin ON auditlog USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS events (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);

CREATE INDEX IF NOT EXISTS events_repoid ON events ((metadata->>'repositoryid'));
CREATE INDEX IF NOT EXISTS events_orgid ON events ((metadata->>'organizationid'));
CREATE INDEX IF NOT EXISTS events_userid ON events ((metadata->>'userid'));
CREATE INDEX IF NOT EXISTS events_gin ON events USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS approvals (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);

CREATE INDEX IF NOT EXISTS metadata_active ON approvals ((metadata->>'active'));
CREATE INDEX IF NOT EXISTS metadata_teamid ON approvals ((metadata->>'teamid'));
CREATE INDEX IF NOT EXISTS approvals_gin ON approvals USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS repositorymetadata (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX IF NOT EXISTS repositorymetadata_gin ON repositorymetadata USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS repositorycache (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX IF NOT EXISTS repositorycache_gin ON repositorycache USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS organizationsettings (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);

CREATE INDEX IF NOT EXISTS organizationsettings_active ON organizationsettings ((metadata->>'active'));
CREATE INDEX IF NOT EXISTS organizationsettings_organizationid ON organizationsettings ((metadata->>'organizationid'));

CREATE TABLE IF NOT EXISTS repositorycollaboratorcache (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX IF NOT EXISTS repositorycollaboratorcache_gin ON repositorycollaboratorcache USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS organizationmembercache (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX IF NOT EXISTS organizationmembercache_gin ON organizationmembercache USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS teamcache (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX IF NOT EXISTS teamcache_gin ON teamcache USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS teammembercache (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX IF NOT EXISTS teammembercache_gin ON teammembercache USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS repositoryteamcache (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX IF NOT EXISTS repositoryteamcache_gin ON repositoryteamcache USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS links (
	linkid text,
	thirdpartytype text NOT NULL,
	thirdpartyid text NOT NULL,
	thirdpartyusername text,
	thirdpartyavatar text,
	corporateid text,
  corporateusername text,
  corporatename text,
	serviceaccount boolean DEFAULT false,
  serviceaccountmail text,
	created timestamp without time zone,
	PRIMARY KEY(thirdpartytype, thirdpartyid)
);

CREATE UNIQUE INDEX IF NOT EXISTS link_id ON links (linkid);

CREATE INDEX IF NOT EXISTS all_links ON links (thirdpartytype);

CREATE UNIQUE INDEX IF NOT EXISTS thirdparty_id ON links (thirdpartytype, thirdpartyid);
CREATE UNIQUE INDEX IF NOT EXISTS thirdparty_lowercase_username ON links (thirdpartytype, lower(thirdpartyusername));

CREATE INDEX IF NOT EXISTS corporate_thirdparty_id ON links (thirdpartytype, corporateid);
CREATE INDEX IF NOT EXISTS corporate_lowercase_thirdparty_username ON links (thirdpartytype, lower(corporateusername));

CREATE INDEX IF NOT EXISTS corporate_id ON links (corporateid);
CREATE INDEX IF NOT EXISTS corporate_lowercase_username ON links (lower(corporateusername));

COMMIT;
