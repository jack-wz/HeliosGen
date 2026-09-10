FROM python:3.13-alpine
RUN apk add --no-cache inotify-tools
WORKDIR /app
COPY asset_sync.py ./asset_sync.py
USER 0:0
ENTRYPOINT ["python", "-u", "/app/asset_sync.py"]
