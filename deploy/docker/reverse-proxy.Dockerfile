# syntax=docker/dockerfile:1.7
FROM nginxinc/nginx-unprivileged:1.27-alpine
ARG PUBLIC_BASE_PATH=/carbon-trader
USER root
COPY deploy/nginx/nginx.conf /tmp/nginx.conf
COPY deploy/nginx/proxy_params /etc/nginx/proxy_params
COPY deploy/nginx/upstream-unavailable.html /usr/share/nginx/html/upstream-unavailable.html
RUN echo "$PUBLIC_BASE_PATH" | grep -Eq '^/[A-Za-z0-9][A-Za-z0-9_-]*(/[A-Za-z0-9][A-Za-z0-9_-]*)*$' \
    && sed "s|__PUBLIC_BASE_PATH__|$PUBLIC_BASE_PATH|g" /tmp/nginx.conf > /etc/nginx/nginx.conf \
    && rm /tmp/nginx.conf
USER 101
EXPOSE 8080
STOPSIGNAL SIGQUIT
