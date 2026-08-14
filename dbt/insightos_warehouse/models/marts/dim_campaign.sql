select
    campaign,
    business_line,
    offering,
    avg_ticket_inr
from {{ ref('seed_campaigns') }}
