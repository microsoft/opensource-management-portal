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

CREATE TABLE IF NOT EXISTS repositorymetadata (
  entitytype text,
  entityid text,
  metadata jsonb,
  PRIMARY KEY(entitytype, entityid)
);

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