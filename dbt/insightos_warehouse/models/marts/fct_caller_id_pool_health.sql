-- Operational health mart for caller-ID pools. A pool whose connect rate
-- drops more than 30% month over month is flagged as a spam-flagging risk -
-- exactly the failure mode telecom carriers cause when they mark outbound
-- DIDs as spam.

with pool_monthly as (

    select * from {{ ref('int_telesales__pool_monthly') }}

)

select
    md5(call_month::text || '|' || caller_id_pool)   as pool_month_key,
    call_month,
    caller_id_pool,
    dials,
    connects,
    round(spend, 2)                                  as spend,
    round(revenue, 2)                                as revenue,
    round(connect_rate, 4)                           as connect_rate,
    round(prev_connect_rate, 4)                      as prev_connect_rate,
    round(connect_rate / nullif(prev_connect_rate, 0) - 1, 4)
                                                     as connect_rate_mom_change,
    coalesce(
        connect_rate / nullif(prev_connect_rate, 0) - 1 < -0.30,
        false
    )                                                as spam_flag_risk
from pool_monthly
