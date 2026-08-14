select
    caller_id_pool,
    pool_description
from {{ ref('seed_caller_id_pools') }}
