BEGIN;

CREATE TABLE IF NOT EXISTS public.settings (
	usertype text,
	userid text,
	settings jsonb,
	PRIMARY KEY(usertype, userid)
);

CREATE TABLE IF NOT EXISTS public.links (
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

CREATE UNIQUE INDEX link_id ON public.links (linkid);

CREATE INDEX all_links ON public.links (thirdpartytype);

CREATE UNIQUE INDEX thirdparty_id ON public.links (thirdpartytype, thirdpartyid);
CREATE UNIQUE INDEX thirdparty_lowercase_username ON public.links (thirdpartytype, lower(thirdpartyusername));

CREATE INDEX corporate_thirdparty_id ON public.links (thirdpartytype, corporateid);
CREATE INDEX corporate_lowercase_thirdparty_username ON public.links (thirdpartytype, lower(corporateusername));

CREATE INDEX corporate_id ON public.links (corporateid);
CREATE INDEX corporate_lowercase_username ON public.links (lower(corporateusername));

COMMIT;