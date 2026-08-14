-- Funnel rolled up to the reporting grain:
-- month x campaign x caller-ID pool x agent type.

with call_blocks as (

    select * from {{ ref('stg_telesales__call_blocks') }}

)

select
    call_month,
    campaign,
    caller_id_pool,
    agent_type,
    count(*)                 as call_blocks,
    sum(dials)               as dials,
    sum(connects)            as connects,
    sum(qualified_leads)     as qualified_leads,
    sum(conversions)         as conversions,
    sum(talk_time_minutes)   as talk_time_minutes,
    avg(qa_score)            as avg_qa_score,
    sum(spend)               as spend,
    sum(revenue)             as revenue
from call_blocks
group by 1, 2, 3, 4
