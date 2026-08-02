"""InsightOS HTTP service - a thin transport shell over ``analytics-core``.

The API deliberately contains no analytics. Every endpoint is a serialisation of
something the engine already computed, which is what makes the static GitHub
Pages demo byte-for-byte equivalent to the live service.
"""

__version__ = "1.0.0"
