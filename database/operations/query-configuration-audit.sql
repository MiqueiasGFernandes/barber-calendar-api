\set ON_ERROR_STOP on
\if :{?audit_tenant_id}
\else
  \echo 'audit_tenant_id is required' >&2
  SELECT 'Invalid audit query parameters'::integer;
\endif
\if :{?audit_from}
\else
  \echo 'audit_from is required' >&2
  SELECT 'Invalid audit query parameters'::integer;
\endif
\if :{?audit_before}
\else
  \echo 'audit_before is required' >&2
  SELECT 'Invalid audit query parameters'::integer;
\endif
\if :{?audit_resource_type}
\else
  \set audit_resource_type ''
\endif
\if :{?audit_resource_id}
\else
  \set audit_resource_id ''
\endif
\if :{?audit_limit}
\else
  \set audit_limit 100
\endif
\if :{?audit_cursor_at}
\else
  \set audit_cursor_at ''
\endif
\if :{?audit_cursor_id}
\else
  \set audit_cursor_id ''
\endif
SELECT (:'audit_from'::timestamptz < :'audit_before'::timestamptz
 AND :'audit_limit'::integer BETWEEN 1 AND 100
 AND :'audit_tenant_id'::uuid IS NOT NULL
 AND (:'audit_resource_type'='' OR :'audit_resource_type' IN ('service','professional','weekly_periods','availability_exception','time_zone','tenant_settings'))
 AND ((:'audit_cursor_at'='') = (:'audit_cursor_id'=''))) AS valid_audit_query \gset
\if :valid_audit_query
\else
  \echo 'Invalid audit query interval, limit, resource type or cursor' >&2
  SELECT 'Invalid audit query parameters'::integer;
\endif
SELECT id,tenant_id,actor_membership_id,operation_id,operation,resource_type,
       resource_id,occurred_at,correlation_id,changes
FROM scheduling.configuration_events
WHERE tenant_id=:'audit_tenant_id'::uuid
  AND occurred_at>=:'audit_from'::timestamptz
  AND occurred_at<:'audit_before'::timestamptz
  AND (:'audit_resource_type'='' OR resource_type=:'audit_resource_type')
  AND (NULLIF(:'audit_resource_id','')::uuid IS NULL OR resource_id=NULLIF(:'audit_resource_id','')::uuid)
  AND (NULLIF(:'audit_cursor_at','')::timestamptz IS NULL OR (occurred_at,id)>(NULLIF(:'audit_cursor_at','')::timestamptz,NULLIF(:'audit_cursor_id','')::uuid))
ORDER BY occurred_at,id
LIMIT :'audit_limit'::integer;
