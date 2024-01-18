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
CREATE INDEX IF NOT EXISTS auditlog_entitytype ON auditlog (entitytype);

CREATE TABLE IF NOT EXISTS events (
  entitytype text,
  entityid text,

  created timestamptz,
  isopencontribution boolean,
  isowncontribution boolean,
  usercorporateid text,
  action text,
  userusername text,
  userid text,
  usercorporateusername text,
  organizationname text,
  organizationid text,
  repositoryname text,
  repositoryid text,
  inserted timestamptz,
  updated timestamptz,
  checked timestamptz,

  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);

CREATE INDEX IF NOT EXISTS events_c_usercorporateid ON events (usercorporateid);
CREATE INDEX IF NOT EXISTS events_c_isopencontribution ON events (isopencontribution);
CREATE INDEX IF NOT EXISTS events_c_cid_isopencontribution ON events (usercorporateid, isopencontribution);
CREATE INDEX IF NOT EXISTS events_c_cid_isopencontribution2 ON events (usercorporateid, isopencontribution, created);
CREATE INDEX IF NOT EXISTS events_created ON events (created);
CREATE INDEX IF NOT EXISTS events_c_cid_created ON events (created, usercorporateid);
CREATE INDEX IF NOT EXISTS events_userid ON events (userid);
CREATE INDEX IF NOT EXISTS events_userid_isopencontribution ON events (userid, isopencontribution);
CREATE INDEX IF NOT EXISTS events_userid_isopencontribution_range ON events (userid, isopencontribution, created);
CREATE INDEX IF NOT EXISTS events_opencontributions_range ON events (created, isopencontribution);
CREATE INDEX IF NOT EXISTS events_orgname ON events (organizationname);
CREATE INDEX IF NOT EXISTS events_orgid ON events (organizationid);
CREATE INDEX IF NOT EXISTS events_repoid ON events (repositoryid);

ALTER TABLE events ADD COLUMN IF NOT EXISTS isowncontribution boolean;
ALTER TABLE events ADD COLUMN IF NOT EXISTS checked timestamptz;

CREATE INDEX IF NOT EXISTS events_c_isowncontribution ON events (isowncontribution);
CREATE INDEX IF NOT EXISTS events_checked ON events (checked);
CREATE INDEX IF NOT EXISTS events_c_cid_checked ON events (usercorporateid);

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

CREATE TABLE IF NOT EXISTS organizationannotations (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);

CREATE INDEX IF NOT EXISTS organizationannotations_organizationid ON organizationannotations ((metadata->>'organizationid'));

CREATE TABLE IF NOT EXISTS usersettings (
  entitytype text,
  entityid text,
  contributionshareoptin boolean,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);

CREATE INDEX IF NOT EXISTS usersettings_contributionoptin ON usersettings (contributionshareoptin);

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
  corporatemail text,
  corporatealias text,
  serviceaccount boolean DEFAULT false,
  serviceaccountmail text,
  created timestamp without time zone,
  PRIMARY KEY(thirdpartytype, thirdpartyid)
);

CREATE UNIQUE INDEX IF NOT EXISTS link_id ON links (linkid);

CREATE INDEX IF NOT EXISTS all_links ON links (thirdpartytype);

CREATE UNIQUE INDEX IF NOT EXISTS thirdparty_id ON links (thirdpartytype, thirdpartyid);
CREATE UNIQUE INDEX IF NOT EXISTS thirdparty_lowercase_username ON links (thirdpartytype, lower(thirdpartyusername));
CREATE UNIQUE INDEX IF NOT EXISTS thirdparty_id_only ON links (thirdpartyid);

CREATE INDEX IF NOT EXISTS corporate_thirdparty_id ON links (thirdpartytype, corporateid);
CREATE INDEX IF NOT EXISTS corporate_lowercase_thirdparty_username ON links (thirdpartytype, lower(corporateusername));

CREATE INDEX IF NOT EXISTS corporate_id ON links (corporateid);
CREATE INDEX IF NOT EXISTS corporate_lowercase_username ON links (lower(corporateusername));

CREATE TABLE IF NOT EXISTS voting (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);

CREATE INDEX IF NOT EXISTS voting_active ON voting ((metadata->>'active'));
CREATE INDEX IF NOT EXISTS voting_electionid ON voting ((metadata->>'electionid'));
CREATE INDEX IF NOT EXISTS voting_results ON voting ((metadata->>'electionid'), (metadata->>'nominationid'));
CREATE INDEX IF NOT EXISTS voting_gin ON voting USING gin (metadata jsonb_path_ops);

CREATE TABLE IF NOT EXISTS repositories (
  entitytype text,
  entityid text,
  metadata jsonb,

  repositoryid bigint,
  organizationid bigint,
  cached timestamptz,
  name text,
  organizationlogin text,
  fullname text,
  private boolean,
  visibility text,
  fork boolean,
  archived boolean,
  disabled boolean,
  pushedat timestamptz,
  createdat timestamptz,
  updatedat timestamptz,
  description text,
  homepage text,
  language text,
  forkscount integer,
  stargazerscount integer,
  watcherscount integer,
  size bigint,
  defaultbranch text,
  openissuescount integer,
  topics text[],
  hasissues boolean,
  hasprojects boolean,
  haswiki boolean,
  haspages boolean,
  hasdownloads boolean,
  subscriberscount integer,
  networkcount integer,
  license text,
  parentid bigint,
  parentname text,
  parentorganizationname text,
  parentorganizationid bigint,

  PRIMARY KEY(entitytype, entityid)
);

CREATE INDEX IF NOT EXISTS repositories_byid ON repositories (repositoryid);
CREATE INDEX IF NOT EXISTS repositories_by_org ON repositories (organizationid);
CREATE INDEX IF NOT EXISTS repositories_byidpriv ON repositories (repositoryid, private);
CREATE INDEX IF NOT EXISTS repositories_byidvis ON repositories (repositoryid, visibility);
CREATE INDEX IF NOT EXISTS repositories_by_created ON repositories (createdat);
CREATE INDEX IF NOT EXISTS repositories_by_updated ON repositories (updatedat);
CREATE INDEX IF NOT EXISTS repositories_by_pushed ON repositories (pushedat);

COMMIT;
