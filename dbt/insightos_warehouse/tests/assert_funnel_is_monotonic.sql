-- The funnel can only narrow: dials >= connects >= qualified >= conversions.
-- Any row violating that ordering indicates corrupt source data.

select call_block_id
from {{ ref('stg_telesales__call_blocks') }}
where connects > dials
   or qualified_leads > connects
   or conversions > qualified_leads
