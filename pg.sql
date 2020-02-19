BEGIN;

CREATE TABLE IF NOT EXISTS settings (
	usertype text,
	userid text,
	settings jsonb,
	PRIMARY KEY(usertype, userid)
);

CREATE TABLE IF NOT EXISTS approvals (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);

CREATE INDEX metadata_active ON approvals ((metadata->>'active'));
CREATE INDEX metadata_teamid ON approvals ((metadata->>'teamid'));
CREATE INDEX approvals_gin ON approvals USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS repositorymetadata (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX repositorymetadata_gin ON repositorymetadata USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS repositorycache (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX repositorycache_gin ON repositorycache USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS organizationsettings (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);

CREATE INDEX organizationsettings_active ON organizationsettings ((metadata->>'active'));
CREATE INDEX organizationsettings_organizationid ON organizationsettings ((metadata->>'organizationid'));

CREATE TABLE IF NOT EXISTS repositorycollaboratorcache (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX repositorycollaboratorcache_gin ON repositorycollaboratorcache USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS organizationmembercache (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX organizationmembercache_gin ON organizationmembercache USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS teamcache (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX teamcache_gin ON teamcache USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS teammembercache (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX teammembercache_gin ON teammembercache USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS repositoryteamcache (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);
CREATE INDEX repositoryteamcache_gin ON repositoryteamcache USING gin (metadata jsonb_path_ops);

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

CREATE UNIQUE INDEX link_id ON links (linkid);

CREATE INDEX all_links ON links (thirdpartytype);

CREATE UNIQUE INDEX thirdparty_id ON links (thirdpartytype, thirdpartyid);
CREATE UNIQUE INDEX thirdparty_lowercase_username ON links (thirdpartytype, lower(thirdpartyusername));

CREATE INDEX corporate_thirdparty_id ON links (thirdpartytype, corporateid);
CREATE INDEX corporate_lowercase_thirdparty_username ON links (thirdpartytype, lower(corporateusername));

CREATE INDEX corporate_id ON links (corporateid);
CREATE INDEX corporate_lowercase_username ON links (lower(corporateusername));

COMMIT;
