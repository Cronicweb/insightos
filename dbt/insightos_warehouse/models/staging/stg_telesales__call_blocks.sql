with source as (

    select * from {{ source('raw', 'telesales_call_blocks') }}

)

select
    call_block_id,
    cast(call_date as date)                          as call_month,
    campaign,
    agent_type,
    caller_id_pool,
    region,
    lead_source,
    dials,
    connects,
    qualified_leads,
    conversions,
    round(cast(talk_time_minutes as numeric), 1)     as talk_time_minutes,
    round(cast(qa_score as numeric), 1)              as qa_score,
    round(cast(campaign_spend as numeric), 2)        as spend,
    round(cast(revenue as numeric), 2)               as revenue
from source
