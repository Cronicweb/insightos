-- Monthly campaign KPIs consumed by dashboards and the InsightOS analytics
-- layer: full funnel rates, unit economics (CPA), and ROAS - the metric whose
-- drop the root-cause engine is expected to attribute to Pool C.

with funnel as (

    select * from {{ ref('int_telesales__monthly_funnel') }}

),

campaign_monthly as (

    select
        call_month,
        campaign,
        sum(dials)             as dials,
        sum(connects)          as connects,
        sum(qualified_leads)   as qualified_leads,
        sum(conversions)       as conversions,
        sum(spend)             as spend,
        sum(revenue)           as revenue
    from funnel
    group by 1, 2

)

select
    md5(call_month::text || '|' || campaign)               as campaign_month_key,
    call_month,
    campaign,
    dials,
    connects,
    qualified_leads,
    conversions,
    round(spend, 2)                                        as spend,
    round(revenue, 2)                                      as revenue,
    round(connects::numeric / nullif(dials, 0), 4)         as connect_rate,
    round(qualified_leads::numeric / nullif(connects, 0), 4)  as qualification_rate,
    round(conversions::numeric / nullif(qualified_leads, 0), 4) as conversion_rate,
    round(spend::numeric / nullif(conversions, 0), 2)      as cpa,
    round(revenue::numeric / nullif(spend, 0), 2)          as roas,
    round(revenue::numeric / nullif(connects, 0), 2)       as revenue_per_connect
from campaign_monthly
