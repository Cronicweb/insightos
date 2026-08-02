# syntax=docker/dockerfile:1
#
# InsightOS API. The analytics engine is copied in and installed as a package so
# the image contains exactly the code the tests ran against.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY apps/api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY packages/analytics-core /srv/packages/analytics-core
RUN pip install --no-cache-dir /srv/packages/analytics-core

COPY apps/api/insightos_api /srv/insightos_api

RUN useradd --create-home --uid 10001 insightos
USER insightos

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"

CMD ["uvicorn", "insightos_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
