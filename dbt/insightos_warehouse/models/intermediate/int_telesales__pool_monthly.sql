-- Caller-ID pool health at monthly grain, with month-over-month movement of
-- the connect rate. This is the series in which the planted carrier
-- spam-flagging incident (Pool C, final month) must be visible.

with funnel as (

    select * from {{ ref('int_telesales__monthly_funnel') }}

),

pool_monthly as (

    select
        call_month,
        caller_id_pool,
        sum(dials)       as dials,
        sum(connects)    as connects,
        sum(spend)       as spend,
        sum(revenue)     as revenue
    from funnel
    group by 1, 2

)

select
    call_month,
    caller_id_pool,
    dials,
    connects,
    spend,
    revenue,
    connects::numeric / nullif(dials, 0)             as connect_rate,
    lag(connects::numeric / nullif(dials, 0)) over (
        partition by caller_id_pool order by call_month
    )                                                as prev_connect_rate
from pool_monthly
