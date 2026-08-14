-- End-to-end pipeline check against the generator's ground truth: the final
-- month must flag exactly one pool as a spam-flagging risk, and it must be
-- Pool C. Fails (returns rows) if the pipeline stops surfacing the planted
-- carrier incident.

with latest as (

    select *
    from {{ ref('fct_caller_id_pool_health') }}
    where call_month = (select max(call_month) from {{ ref('fct_caller_id_pool_health') }})

),

flagged as (

    select caller_id_pool from latest where spam_flag_risk

)

select 'wrong_pool_flagged' as failure, caller_id_pool
from flagged
where caller_id_pool <> 'Pool C'

union all

select 'pool_c_not_flagged' as failure, 'Pool C'
where not exists (select 1 from flagged where caller_id_pool = 'Pool C')
